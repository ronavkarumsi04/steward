import "dotenv/config";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignupService } from "@steward/core";
import { closeDb, getDb } from "@steward/db";

export async function waitlist(args: string[], appUrl: string | undefined, service: Pick<SignupService, "list" | "admit">) {
  const [command, ...rest] = args;
  const { values } = parseArgs({ args: rest, options: { email: { type: "string" } }, strict: true });
  if (command === "list" && !values.email) return JSON.stringify(await service.list(), null, 2);
  if (command !== "admit" || !values.email) throw new Error("Usage: waitlist list | waitlist admit --email founder@example.com");
  if (!appUrl) throw new Error("APP_URL is required");
  const url = new URL(appUrl.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.href.includes("?") || url.href.includes("#")) throw new Error("APP_URL must be a bare HTTP(S) origin");
  const { token } = await service.admit({ email: values.email }, null);
  return `${url.origin}/register?waitlist=${encodeURIComponent(token)}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(await waitlist(process.argv.slice(2), process.env.APP_URL, new SignupService(getDb())));
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Waitlist operation failed");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
