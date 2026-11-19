import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate:
 *  - redirects pages to /login when no session cookie exists (real authorization is server-side in requireUser);
 *  - rejects cross-site state-changing API calls from browsers (CSRF defence in addition to SameSite=Lax).
 *    Collectors send no Origin header and authenticate with bearer tokens, so they are unaffected.
 */
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin");
    if (UNSAFE.has(req.method) && origin) {
      const allowed = new Set([req.nextUrl.origin, ...(process.env.APP_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
      if (host) allowed.add(`${proto}://${host}`);
      if (!allowed.has(origin)) return NextResponse.json({ ok: false, error: { code: "FORBIDDEN_ORIGIN", message: "Cross-origin request rejected" } }, { status: 403 });
    }
    return NextResponse.next();
  }
  if (!req.cookies.has("netmon_session") && !pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next|favicon.ico|socket.io).*)"] };
