import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CompanionConfig {
  server: string;
  deviceId: string;
  deviceKey: string;
  name: string;
  /** Codex sandbox mode used for `codex exec`. Read-only by default: agents get text, not disk access. */
  codexSandbox: "read-only" | "workspace-write";
  codexBin: string;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.STEWARD_COMPANION_CONFIG ?? join(env.STEWARD_HOME ?? join(homedir(), ".steward"), "companion.json");
}

export async function loadConfig(path = configPath()): Promise<CompanionConfig | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<CompanionConfig>;
    if (!raw.server || !raw.deviceId || !raw.deviceKey) return null;
    return { server: raw.server, deviceId: raw.deviceId, deviceKey: raw.deviceKey, name: raw.name ?? "companion", codexSandbox: raw.codexSandbox ?? "read-only", codexBin: raw.codexBin ?? "codex" };
  } catch {
    return null;
  }
}

/** Writes the config with owner-only permissions; the device key is the only credential on disk. */
export async function saveConfig(cfg: CompanionConfig, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function clearConfig(path = configPath()): Promise<void> {
  await rm(path, { force: true });
}
