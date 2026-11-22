import { NextResponse, type NextRequest } from "next/server";
import { proxyClientHeaders } from "./lib/proxy-client-ip";

const SESSION_COOKIE = "steward_session";

/**
 * Cheap pre-check: requests to the workspace without any session cookie go straight to /login with the
 * intended destination preserved. Real session validation still happens server-side in the layouts.
 */
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/api/v1" || req.nextUrl.pathname.startsWith("/api/v1/")) {
    const headers = new Headers(req.headers);
    headers.delete("x-steward-client-ip");
    headers.delete("x-steward-proxy-secret");
    const clientHeaders = proxyClientHeaders(req.headers, process.env, (req as NextRequest & { ip?: string }).ip);
    for (const [name, value] of Object.entries(clientHeaders)) headers.set(name, value);
    return NextResponse.next({ request: { headers } });
  }
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app/:path*", "/api/v1/:path*"] };
