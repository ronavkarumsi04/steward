import "server-only";
import { embeddedFetch } from "./embedded-api";

export function serverTransport(env: Record<string, string | undefined> = process.env): { baseUrl: string; fetchImpl: typeof fetch } {
  if (env.EMBEDDED_API === "true") {
    return { baseUrl: (env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, ""), fetchImpl: embeddedFetch };
  }
  return { baseUrl: (env.API_INTERNAL_URL?.trim() || env.API_URL?.trim() || "http://localhost:4000").replace(/\/$/, ""), fetchImpl: fetch };
}
