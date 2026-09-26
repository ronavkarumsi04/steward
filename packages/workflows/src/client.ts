import { readFile } from "node:fs/promises";
import { Client, Connection, ScheduleOverlapPolicy, WorkflowNotFoundError, ScheduleNotFoundError, type ScheduleHandle } from "@temporalio/client";
import { APPROVAL_SIGNAL, CANCEL_SIGNAL, HOUSEKEEPING_SCHEDULE_ID, HOUSEKEEPING_WORKFLOW_ID, STATUS_QUERY, TASK_QUEUE_DEFAULT, runWorkflowId, scheduleWorkflowId, type AgentRunInput, type ApprovalDecisionSignal, type ScheduledRunInput } from "./types.js";

export interface TemporalConfig {
  address: string;
  namespace: string;
  taskQueue: string;
  /** mTLS for Temporal Cloud / hardened deployments. */
  tls?: { clientCertPath?: string; clientKeyPath?: string; serverRootCACertPath?: string } | null;
  apiKey?: string;
}

export function temporalConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TemporalConfig {
  return {
    address: env.TEMPORAL_ADDRESS ?? "localhost:7233",
    namespace: env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE_DEFAULT,
    tls: env.TEMPORAL_TLS_CERT_PATH ? { clientCertPath: env.TEMPORAL_TLS_CERT_PATH, clientKeyPath: env.TEMPORAL_TLS_KEY_PATH, serverRootCACertPath: env.TEMPORAL_TLS_CA_PATH } : null,
    // Normalize empty-string env vars: an empty TEMPORAL_API_KEY would make the Temporal client auto-enable TLS
    // and fail to connect to a plaintext local server ("Failed to connect before the deadline").
    apiKey: env.TEMPORAL_API_KEY?.trim() ? env.TEMPORAL_API_KEY.trim() : undefined,
  };
}

export async function connectTemporal(cfg: TemporalConfig): Promise<Client> {
  const tls = cfg.tls?.clientCertPath && cfg.tls.clientKeyPath
    ? { clientCertPair: { crt: await readFile(cfg.tls.clientCertPath), key: await readFile(cfg.tls.clientKeyPath) }, serverRootCACertificate: cfg.tls.serverRootCACertPath ? await readFile(cfg.tls.serverRootCACertPath) : undefined }
    : cfg.apiKey ? true : undefined;
  const connection = await Connection.connect({ address: cfg.address, tls, apiKey: cfg.apiKey, connectTimeout: "10s" });
  return new Client({ connection, namespace: cfg.namespace });
}

/** Thin, typed facade so the API never imports workflow internals. */
export class WorkflowClient {
  constructor(private readonly client: Client, private readonly taskQueue: string) {}

  get raw() {
    return this.client;
  }

  /** Starts the workflow for an already-persisted run. Idempotent on runId (workflow id reuse policy rejects duplicates). */
  async startRun(input: AgentRunInput): Promise<{ workflowId: string; workflowRunId: string }> {
    const handle = await this.client.workflow.start("agentRunWorkflow", {
      workflowId: runWorkflowId(input.runId),
      taskQueue: this.taskQueue,
      args: [input],
      workflowExecutionTimeout: "14 days",
      memo: { organizationId: input.scope.organizationId, companyId: input.scope.companyId },
      searchAttributes: {},
    });
    return { workflowId: handle.workflowId, workflowRunId: handle.firstExecutionRunId };
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
