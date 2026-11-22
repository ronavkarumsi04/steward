export function proxyClientHeaders(incoming: Headers, env: Record<string, string | undefined>, ip?: string): Record<string, string> {
  if (!env.STEWARD_PROXY_SECRET) return {};
  const clientIp = env.VERCEL
    ? incoming.get("x-vercel-forwarded-for")?.trim() || incoming.get("x-forwarded-for")?.split(",")[0]?.trim()
    : ip;
  if (!clientIp) return {};
  return { "x-steward-client-ip": clientIp, "x-steward-proxy-secret": env.STEWARD_PROXY_SECRET };
}
