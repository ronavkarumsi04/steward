import { readFile } from "node:fs/promises";
import { Client, Connection, ScheduleOverlapPolicy, WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError, ScheduleNotFoundError, type ScheduleHandle } from "@temporalio/client";
import { APPROVAL_SIGNAL, CANCEL_SIGNAL, HOUSEKEEPING_SCHEDULE_ID, HOUSEKEEPING_WORKFLOW_ID, STATUS_QUERY, TASK_QUEUE_DEFAULT, runWorkflowId, scheduleWorkflowId, type AgentRunInput, type ApprovalDecisionSignal, type ScheduledRunInput } from "./types.js";

export interface TemporalConfig {
  address: string;
  namespace: string;
  taskQueue: string;
  /** mTLS for Temporal Cloud / hardened deployments. */
  tls?: { clientCertPath?: string; clientKeyPath?: string; serverRootCACertPath?: string } | null;
  apiKey?: string;
}

/** Reads a variable and treats blank strings as absent, which is how an unset-looking `.env` line should behave. */
function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw ? raw : undefined;
}

/**
 * The one place temporal settings are read from the environment, shared by the API, the worker and the
 * embedded runtime so they cannot disagree about what "configured" means.
 *
 * Blank values are treated as absent on purpose: an empty `TEMPORAL_API_KEY` used to make the Temporal client
 * auto-enable TLS against a plaintext server, which surfaced as "Failed to connect before the deadline".
 */
export function temporalConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TemporalConfig {
  const certPath = envValue(env, "TEMPORAL_TLS_CERT_PATH");
  const keyPath = envValue(env, "TEMPORAL_TLS_KEY_PATH");
  const caPath = envValue(env, "TEMPORAL_TLS_CA_PATH");
  return {
    address: envValue(env, "TEMPORAL_ADDRESS") ?? "localhost:7233",
    namespace: envValue(env, "TEMPORAL_NAMESPACE") ?? "default",
    taskQueue: envValue(env, "TEMPORAL_TASK_QUEUE") ?? TASK_QUEUE_DEFAULT,
    tls: certPath || keyPath || caPath ? { clientCertPath: certPath, clientKeyPath: keyPath, serverRootCACertPath: caPath } : null,
    apiKey: envValue(env, "TEMPORAL_API_KEY"),
  };
}

/** How long a caller waits for Temporal before serving without it. Clamped so a typo cannot hang a boot. */
export function temporalConnectTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(envValue(env, "TEMPORAL_CONNECT_TIMEOUT_MS") ?? 10_000);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 60_000) : 10_000;
}

export interface TemporalTlsMaterial {
  serverRootCACertificate?: Buffer;
  clientCertPair?: { crt: Buffer; key: Buffer };
}

/**
 * Turns TLS configuration into connection options. A half-configured mTLS pair is an error rather than a
 * silent downgrade: connecting without the certificate the operator asked for is worse than not connecting.
 */
export async function temporalTlsMaterial(cfg: TemporalConfig): Promise<TemporalTlsMaterial | boolean | undefined> {
  const certPath = cfg.tls?.clientCertPath;
  const keyPath = cfg.tls?.clientKeyPath;
  if (certPath && keyPath) {
    return {
      clientCertPair: { crt: await readFile(certPath), key: await readFile(keyPath) },
      ...(cfg.tls?.serverRootCACertPath ? { serverRootCACertificate: await readFile(cfg.tls.serverRootCACertPath) } : {}),
    };
  }
  if (certPath || keyPath) {
    throw new Error("TEMPORAL_TLS_CERT_PATH and TEMPORAL_TLS_KEY_PATH must be set together; a certificate without its key would silently connect without mTLS");
  }
  if (cfg.tls?.serverRootCACertPath) return { serverRootCACertificate: await readFile(cfg.tls.serverRootCACertPath) };
  return cfg.apiKey ? true : undefined;
}

export async function connectTemporal(cfg: TemporalConfig, timeoutMs = temporalConnectTimeoutMs()): Promise<Client> {
  const tls = await temporalTlsMaterial(cfg);
  const connection = await Connection.connect({ address: cfg.address, tls, apiKey: cfg.apiKey, connectTimeout: `${timeoutMs}ms` });
  return new Client({ connection, namespace: cfg.namespace });
}

/** Thin, typed facade so the API never imports workflow internals. */
export class WorkflowClient {
  constructor(private readonly client: Client, private readonly taskQueue: string) {}

  get raw() {
    return this.client;
  }

  async close(): Promise<void> {
    await this.client.connection.close();
  }

  /** Live, namespace-scoped RPCs with a real gRPC deadline; no cached connection claim. */
  async readiness(includeWorkers = false): Promise<{ connected: boolean; workers: boolean }> {
    const now = Date.now();
    try {
      return await this.client.connection.withDeadline(now + 3_000, async () => {
        const namespace = this.client.options.namespace;
        await this.client.workflowService.describeNamespace({ namespace });
        if (!includeWorkers) return { connected: true, workers: false };
        const queues = await Promise.all([1, 2].map((taskQueueType) =>
          this.client.workflowService.describeTaskQueue({ namespace, taskQueue: { name: this.taskQueue }, taskQueueType }),
        ));
        // A stopped worker can remain in Temporal's poller list. Require recent access on both queues.
        const workers = queues.every((queue) => queue.pollers?.some((poller) => {
          const accessed = Number(poller.lastAccessTime?.seconds ?? 0) * 1_000;
          return accessed >= now - 90_000 && accessed <= now + 30_000;
        }) === true);
        return { connected: true, workers };
      });
    } catch {
      return { connected: false, workers: false };
    }
  }

  /**
   * Starts the workflow for an already-persisted run, at the run's deterministic workflow id.
   *
   * Idempotent on runId: if the execution already exists (a retried launch, or the reconciler picking up a
   * run whose first attempt was interrupted after the workflow started), this returns the existing execution
   * rather than creating a second one. That idempotence is what lets the caller persist the workflow id
   * before starting, and lets a retry be safe.
   */
  async startRun(input: AgentRunInput): Promise<{ workflowId: string; workflowRunId: string }> {
    const workflowId = runWorkflowId(input.runId);
    try {
      const handle = await this.client.workflow.start("agentRunWorkflow", {
        workflowId,
        taskQueue: this.taskQueue,
        args: [input],
        workflowExecutionTimeout: "14 days",
        memo: { organizationId: input.scope.organizationId, companyId: input.scope.companyId },
        searchAttributes: {},
      });
      return { workflowId: handle.workflowId, workflowRunId: handle.firstExecutionRunId };
    } catch (e) {
      if (e instanceof WorkflowExecutionAlreadyStartedError) {
        const existing = await this.client.workflow.getHandle(workflowId).describe();
        return { workflowId, workflowRunId: existing.runId };
      }
      throw e;
    }
  }

  async signalApproval(workflowId: string, decision: ApprovalDecisionSignal): Promise<boolean> {
    try {
      await this.client.workflow.getHandle(workflowId).signal(APPROVAL_SIGNAL, decision);
      return true;
    } catch (e) {
      if (e instanceof WorkflowNotFoundError) return false;
      throw e;
    }
  }

  async cancelRun(runId: string, reason?: string): Promise<boolean> {
    try {
      await this.client.workflow.getHandle(runWorkflowId(runId)).signal(CANCEL_SIGNAL, { reason });
      return true;
    } catch (e) {
      if (e instanceof WorkflowNotFoundError) return false;
      throw e;
    }
  }

  async runStatus(runId: string): Promise<{ phase: string; iterations: number; waitingApprovalId: string | null } | null> {
    try {
      return await this.client.workflow.getHandle(runWorkflowId(runId)).query(STATUS_QUERY);
    } catch (e) {
      if (e instanceof WorkflowNotFoundError) return null;
      throw e;
    }
  }

  /** Creates or updates the Temporal Schedule backing an agent schedule row. */
  async upsertSchedule(input: ScheduledRunInput & { cron: string; timezone: string; enabled: boolean }): Promise<string> {
    const id = scheduleWorkflowId(input.scheduleId);
    const action = { type: "startWorkflow", workflowType: "scheduledRunWorkflow", taskQueue: this.taskQueue, args: [{ scheduleId: input.scheduleId, scope: input.scope }], workflowExecutionTimeout: "14 days" } as const;
    const spec = { cronExpressions: [input.cron], timezone: input.timezone };
    const policies = { overlap: ScheduleOverlapPolicy.SKIP, catchupWindow: "10 minutes" } as const;
    let handle: ScheduleHandle;
    try {
      handle = this.client.schedule.getHandle(id);
      await handle.describe();
      await handle.update((prev) => ({ ...prev, spec, action: { ...prev.action, ...action }, policies: { ...prev.policies, ...policies }, state: { ...prev.state, paused: !input.enabled } }));
    } catch (e) {
      if (!(e instanceof ScheduleNotFoundError)) throw e;
      await this.client.schedule.create({ scheduleId: id, spec, action, policies, state: { paused: !input.enabled }, memo: { organizationId: input.scope.organizationId, companyId: input.scope.companyId } });
    }
    return id;
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    try {
      await this.client.schedule.getHandle(scheduleWorkflowId(scheduleId)).delete();
    } catch (e) {
      if (!(e instanceof ScheduleNotFoundError)) throw e;
    }
  }

  async triggerSchedule(scheduleId: string): Promise<void> {
    await this.client.schedule.getHandle(scheduleWorkflowId(scheduleId)).trigger(ScheduleOverlapPolicy.SKIP);
  }

  /** Platform housekeeping every 5 minutes (approval expiry, sandbox reaping, stale-run detection). */
  async ensureHousekeeping(): Promise<void> {
    try {
      await this.client.schedule.getHandle(HOUSEKEEPING_SCHEDULE_ID).describe();
    } catch (e) {
      if (!(e instanceof ScheduleNotFoundError)) throw e;
      await this.client.schedule.create({
        scheduleId: HOUSEKEEPING_SCHEDULE_ID,
        spec: { intervals: [{ every: "5 minutes" }] },
        action: { type: "startWorkflow", workflowType: "housekeepingWorkflow", taskQueue: this.taskQueue, workflowId: HOUSEKEEPING_WORKFLOW_ID, args: [] },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      });
    }
  }
}
