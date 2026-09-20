import { ApiError, StewardClient } from "./client.js";
import { codexExec, codexStatus } from "./codex.js";
import type { CompanionConfig } from "./config.js";
import { COMMANDS, type ExecPayload, type PendingCommand } from "./protocol.js";

export interface DaemonOptions {
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  pollWaitMs?: number;
  /** Max concurrent `codex exec` processes. */
  concurrency?: number;
  signal?: AbortSignal;
}

function isExecPayload(p: Record<string, unknown>): p is ExecPayload & Record<string, unknown> {
  return Array.isArray(p.messages);
}

/**
 * Long-poll loop: fetch commands, execute the restricted command set, post results. Reconnects with
 * exponential backoff; a revoked device key stops the loop (the operator revoked it on purpose).
 */
export async function runDaemon(cfg: CompanionConfig, opts: DaemonOptions = {}): Promise<"revoked" | "stopped"> {
  const log = opts.log ?? (() => {});
  const client = new StewardClient(cfg.server, cfg.deviceKey);
  const limit = opts.concurrency ?? 2;
  let active = 0;
  let backoff = 1000;

  async function handle(cmd: PendingCommand) {
    active++;
    try {
      switch (cmd.command) {
        case "ping":
          await client.result({ id: cmd.id, type: "result", result: { pong: true, at: new Date().toISOString(), name: cfg.name } });
          return;
        case "codex.status": {
          const st = await codexStatus(cfg.codexBin);
          await client.result({ id: cmd.id, type: "result", result: { ...st } });
          return;
        }
        case "codex.exec": {
          if (!isExecPayload(cmd.payload)) throw new Error("codex.exec payload must include messages[]");
          const started = Date.now();
          const r = await codexExec(cmd.payload, {
            bin: cfg.codexBin,
            sandbox: cfg.codexSandbox,
            signal: opts.signal,
            onEvent: cmd.streaming ? (ev) => void client.result({ id: cmd.id, type: "event", event: ev }).catch(() => {}) : undefined,
          });
          log("codex.exec finished", { id: cmd.id, ms: Date.now() - started, error: r.error, tokens: r.usage });
          await client.result({ id: cmd.id, type: "result", result: { ...r } });
          return;
        }
        default:
          throw new Error(`Unsupported command ${String(cmd.command)}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log("command failed", { id: cmd.id, command: cmd.command, error: message });
      await client.result({ id: cmd.id, type: "error", error: message }).catch(() => {});
    } finally {
      active--;
    }
  }

  while (!opts.signal?.aborted) {
    try {
      const wait = active >= limit ? 0 : (opts.pollWaitMs ?? 25_000);
      const { commands } = await client.poll(wait, COMMANDS, opts.signal);
      backoff = 1000;
      for (const cmd of commands) {
        if (!COMMANDS.includes(cmd.command)) {
          await client.result({ id: cmd.id, type: "error", error: `Command ${String(cmd.command)} is not permitted on this companion` }).catch(() => {});
          continue;
        }
        void handle(cmd);
      }
      if (active >= limit) await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      if (opts.signal?.aborted) break;
      if (e instanceof ApiError && e.status === 401) {
        log("device key rejected; this device was revoked", {});
        return "revoked";
      }
      log("poll failed; retrying", { error: e instanceof Error ? e.message : String(e), backoffMs: backoff });
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
  return "stopped";
}
