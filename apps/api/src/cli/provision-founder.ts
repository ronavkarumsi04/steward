import "dotenv/config";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OrganizationService } from "@steward/core";
import { closeDb, getDb } from "@steward/db";

export async function provisionFounder(args: string[], appUrl: string, service: Pick<OrganizationService, "provisionFounderOrganization">) {
  const { values } = parseArgs({ args, options: { org: { type: "string" }, "owner-email": { type: "string" } }, strict: true });
  if (!values.org || !values["owner-email"]) throw new Error('Usage: provision:founder --org "Name" --owner-email founder@example.com');
  const url = new URL(appUrl.trim());
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.href.includes("?") || url.href.includes("#")) throw new Error("APP_URL must be a bare HTTP(S) origin");
  const { token } = await service.provisionFounderOrganization({ name: values.org, ownerEmail: values["owner-email"], operatorUserId: null });
  return `${url.origin}/invite/${token}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.env.APP_URL) throw new Error("APP_URL is required");
    console.log(await provisionFounder(process.argv.slice(2), process.env.APP_URL, new OrganizationService(getDb())));
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Provisioning failed");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
