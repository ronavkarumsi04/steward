import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "steward_session";

/**
 * Cheap pre-check: requests to the workspace without any session cookie go straight to /login with the
 * intended destination preserved. Real session validation still happens server-side in the layouts.
 */
export function proxy(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app/:path*"] };
