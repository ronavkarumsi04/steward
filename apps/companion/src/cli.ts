#!/usr/bin/env node
import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { StewardClient } from "./client.js";
import { codexStatus } from "./codex.js";
import { clearConfig, configPath, loadConfig, saveConfig, type CompanionConfig } from "./config.js";
import { runDaemon } from "./daemon.js";
import { COMMANDS } from "./protocol.js";

const HELP = `steward-companion — run the official Codex CLI locally on behalf of your Steward agents.

Your ChatGPT/Codex login never leaves this machine. Steward only holds a hashed device key that you can revoke
from Organization → Providers → Local Companions at any time.

Usage:
  steward-companion pair --server <https://steward.example.com> --code <123456> [--name <label>]
  steward-companion run [--sandbox read-only|workspace-write] [--codex <path>]
  steward-companion status
  steward-companion unpair

Prerequisites: Node 20+, and the Codex CLI installed and logged in:  npm i -g @openai/codex && codex login
Config: ${configPath()}  (override with STEWARD_COMPANION_CONFIG)
`;

function log(msg: string, extra?: Record<string, unknown>) {
  const line = `[${new Date().toISOString()}] ${msg}${extra && Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`;
  process.stderr.write(line + "\n");
}

async function pair(args: string[]) {
  const { values } = parseArgs({ args, options: { server: { type: "string" }, code: { type: "string" }, name: { type: "string" }, sandbox: { type: "string" }, codex: { type: "string" } } });
  if (!values.server || !values.code) throw new Error("--server and --code are required");
  if (!/^https:\/\//.test(values.server) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(values.server)) throw new Error("--server must use https:// (http is only allowed for localhost)");
  const name = values.name ?? hostname();
  const res = await new StewardClient(values.server).pair(values.code, name, COMMANDS);
  const cfg: CompanionConfig = {
    server: values.server,
    deviceId: res.device.id,
    deviceKey: res.deviceKey,
    name,
    codexSandbox: values.sandbox === "workspace-write" ? "workspace-write" : "read-only",
    codexBin: values.codex ?? "codex",
  };
  await saveConfig(cfg);
  log(`paired as "${name}" (device ${res.device.id}); key saved to ${configPath()} with mode 0600`);
  const st = await codexStatus(cfg.codexBin);
  if (!st.loggedIn) log(`warning: Codex CLI is not logged in (${st.detail ?? "unknown"}). Run: codex login`);
  log("now run: steward-companion run");
}

async function requireConfig(): Promise<CompanionConfig> {
  const cfg = await loadConfig();
  if (!cfg) throw new Error(`not paired; run "steward-companion pair" first (config: ${configPath()})`);
  return cfg;
}

async function run(args: string[]) {
  const { values } = parseArgs({ args, options: { sandbox: { type: "string" }, codex: { type: "string" }, concurrency: { type: "string" } } });
  const cfg = await requireConfig();
  if (values.sandbox === "read-only" || values.sandbox === "workspace-write") cfg.codexSandbox = values.sandbox;
  if (values.codex) cfg.codexBin = values.codex;
  const st = await codexStatus(cfg.codexBin);
  log(`codex ${st.version ?? "(missing)"}; logged in: ${st.loggedIn}${st.detail ? ` (${st.detail})` : ""}`);
  const me = await new StewardClient(cfg.server, cfg.deviceKey).me();
  log(`connected to ${cfg.server} as device ${me.device.id} (${me.device.name}); sandbox=${cfg.codexSandbox}`);
  const ac = new AbortController();
  const stop = () => {
    log("shutting down");
    ac.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const outcome = await runDaemon(cfg, { log, signal: ac.signal, concurrency: values.concurrency ? Number(values.concurrency) : undefined });
  if (outcome === "revoked") {
    await clearConfig();
    log("device revoked by the organization; local key deleted");
    process.exitCode = 2;
  }
}

async function status() {
  const cfg = await loadConfig();
  const st = await codexStatus(cfg?.codexBin ?? "codex");
  const out = {
    configPath: configPath(),
    paired: !!cfg,
    server: cfg?.server,
    deviceId: cfg?.deviceId,
    name: cfg?.name,
    codex: st,
    reachable: undefined as boolean | undefined,
  };
  if (cfg) {
    try {
      await new StewardClient(cfg.server, cfg.deviceKey).me();
      out.reachable = true;
    } catch {
      out.reachable = false;
    }
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "pair":
      return pair(rest);
    case "run":
      return run(rest);
    case "status":
      return status();
    case "unpair":
      await clearConfig();
      log("local device key deleted; revoke it in Steward too if you have not already");
      return;
    default:
      process.stdout.write(HELP);
      if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exitCode = 1;
  }
}

main().catch((e) => {
  log(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
