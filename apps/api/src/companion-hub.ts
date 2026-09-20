import { randomUUID } from "node:crypto";
import type { CompanionBridge } from "@steward/ai";
import type { CompanionCommand } from "@steward/core";

export interface PendingCommand {
  id: string;
  command: CompanionCommand;
  payload: Record<string, unknown>;
  streaming: boolean;
}

interface Inflight {
  deviceId: string;
  resolve: (r: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  onEvent?: (ev: Record<string, unknown>) => void;
  timer: NodeJS.Timeout;
  delivered: boolean;
}

interface DeviceState {
  queue: PendingCommand[];
  waiter?: { resolve: (cmds: PendingCommand[]) => void; timer: NodeJS.Timeout };
  lastPollAt: number;
}

export class CompanionOfflineError extends Error {
  constructor(deviceId: string) {
    super(`Companion device ${deviceId} is not connected`);
    this.name = "CompanionOfflineError";
  }
}

const ONLINE_WINDOW_MS = 45_000;
const DELIVERY_TIMEOUT_MS = 30_000;

/**
 * Brokers commands from the control plane to Local Companions over HTTPS long-polling.
 * A companion holds one outstanding `poll` request; commands issued in the meantime are queued and flushed
 * to it, results (and streaming events) come back on separate POSTs correlated by command id.
 * State is in-process: with several API replicas, route companion traffic to a single replica.
 */
export class CompanionHub implements CompanionBridge {
  private readonly devices = new Map<string, DeviceState>();
  private readonly inflight = new Map<string, Inflight>();

  isOnline(deviceId: string): boolean {
    const d = this.devices.get(deviceId);
    return !!d && (d.waiter !== undefined || Date.now() - d.lastPollAt < ONLINE_WINDOW_MS);
  }

  onlineDeviceIds(): string[] {
    return [...this.devices.keys()].filter((id) => this.isOnline(id));
  }

  /** Long-poll from a companion: returns queued commands immediately or waits up to `waitMs` for one. */
  poll(deviceId: string, waitMs: number): Promise<PendingCommand[]> {
    const d = this.state(deviceId);
    d.lastPollAt = Date.now();
    if (d.waiter) {
      clearTimeout(d.waiter.timer);
      d.waiter.resolve([]);
      d.waiter = undefined;
    }
    if (d.queue.length) {
      const cmds = d.queue.splice(0);
      for (const c of cmds) this.markDelivered(c.id);
      return Promise.resolve(cmds);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (d.waiter?.resolve === resolve) d.waiter = undefined;
        resolve([]);
      }, waitMs);
      d.waiter = { resolve, timer };
    });
  }

  /** Result or stream event posted back by a companion. Returns false when the id is unknown (stale/duplicate). */
  deliver(deviceId: string, msg: { id: string; type: "result" | "event" | "error"; result?: Record<string, unknown>; event?: Record<string, unknown>; error?: string }): boolean {
    const inf = this.inflight.get(msg.id);
    if (!inf || inf.deviceId !== deviceId) return false;
    this.state(deviceId).lastPollAt = Date.now();
    if (msg.type === "event") {
      inf.onEvent?.(msg.event ?? {});
      return true;
    }
    clearTimeout(inf.timer);
    this.inflight.delete(msg.id);
    if (msg.type === "error") inf.reject(new Error(msg.error ?? "Companion reported an error"));
    else inf.resolve(msg.result ?? {});
    return true;
  }

  request(deviceId: string, command: CompanionCommand, payload: Record<string, unknown>, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Record<string, unknown>> {
    return this.send(deviceId, command, payload, { ...opts, streaming: false });
  }

  async *stream(deviceId: string, command: "codex.exec", payload: Record<string, unknown>, opts?: { signal?: AbortSignal }): AsyncIterable<Record<string, unknown>> {
    const buffer: Record<string, unknown>[] = [];
    let wake: (() => void) | undefined;
    let finished: { result?: Record<string, unknown>; error?: Error } | undefined;
    const push = (ev: Record<string, unknown>) => {
      buffer.push(ev);
      wake?.();
    };
    this.send(deviceId, command, payload, { streaming: true, timeoutMs: 15 * 60_000, signal: opts?.signal, onEvent: push })
      .then((result) => {
        finished = { result };
        wake?.();
      })
      .catch((error: unknown) => {
        finished = { error: error instanceof Error ? error : new Error(String(error)) };
        wake?.();
      });
    for (;;) {
      while (buffer.length) yield buffer.shift()!;
      if (finished) {
        if (finished.error) yield { type: "error", error: finished.error.message };
        else yield { type: "done", result: finished.result };
        return;
      }
      await new Promise<void>((r) => (wake = r));
      wake = undefined;
    }
  }

  private send(deviceId: string, command: CompanionCommand, payload: Record<string, unknown>, opts: { timeoutMs?: number; signal?: AbortSignal; streaming: boolean; onEvent?: (ev: Record<string, unknown>) => void }): Promise<Record<string, unknown>> {
    if (!this.isOnline(deviceId)) return Promise.reject(new CompanionOfflineError(deviceId));
    const id = randomUUID();
    const d = this.state(deviceId);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const fail = (e: Error) => {
        this.inflight.delete(id);
        d.queue = d.queue.filter((c) => c.id !== id);
        reject(e);
      };
      const timer = setTimeout(() => fail(new Error(`Companion command ${command} timed out`)), opts.timeoutMs ?? 60_000);
      const inf: Inflight = { deviceId, resolve, reject: fail, onEvent: opts.onEvent, timer, delivered: false };
      this.inflight.set(id, inf);
      opts.signal?.addEventListener("abort", () => fail(new Error("Companion command aborted")), { once: true });
      // If the companion never picks the command up, fail fast instead of waiting the full execution timeout.
      setTimeout(() => {
        if (this.inflight.get(id) === inf && !inf.delivered) fail(new CompanionOfflineError(deviceId));
      }, DELIVERY_TIMEOUT_MS).unref();

      const cmd: PendingCommand = { id, command, payload, streaming: opts.streaming };
      if (d.waiter) {
        const w = d.waiter;
        d.waiter = undefined;
        clearTimeout(w.timer);
        this.markDelivered(id);
        w.resolve([cmd]);
      } else {
        d.queue.push(cmd);
      }
    });
  }

  private markDelivered(id: string) {
    const inf = this.inflight.get(id);
    if (inf) inf.delivered = true;
  }

  private state(deviceId: string): DeviceState {
    let d = this.devices.get(deviceId);
    if (!d) {
      d = { queue: [], lastPollAt: 0 };
      this.devices.set(deviceId, d);
    }
    return d;
  }
}
