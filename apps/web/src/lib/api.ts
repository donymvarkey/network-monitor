import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import type { ApiResponse } from "@netmon/shared-types";
import { paginationSchema, type Pagination } from "@netmon/shared-validation";
import { getSession, SESSION_IDLE_SEC, SESSION_MAX_AGE_SEC } from "./session";
import { prisma } from "./prisma";
import { checkSession } from "./auth-policy";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function ok<T>(data: T, meta?: { page: number; pageSize: number; total: number }) {
  return NextResponse.json<ApiResponse<T>>({ ok: true, data, ...(meta ? { meta } : {}) });
}

export function parsePagination(req: NextRequest): Pagination {
  return paginationSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
}

/** Validates the session against the database on every request (revocation, disable, role change, expiry). */
export async function requireUser() {
  const s = await getSession();
  const user = s.userId ? await prisma.user.findUnique({ where: { id: s.userId }, select: { id: true, role: true, sessionVersion: true, disabled: true } }) : null;
  const now = Math.floor(Date.now() / 1000);
  const v = checkSession(s, user, now, SESSION_MAX_AGE_SEC, SESSION_IDLE_SEC);
  if (!v.ok) {
    if (s.userId) s.destroy();
    throw new ApiError(401, v.reason === "NO_SESSION" ? "UNAUTHORIZED" : "SESSION_EXPIRED", "Authentication required");
  }
  if (v.refresh) { s.seen = now; s.role = v.role; await s.save(); }
  return { userId: s.userId!, role: v.role };
}

export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Administrator role required");
  return u;
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string } & Record<string, string>> }) => Promise<Response>;

/** Wraps a route handler with auth (unless public) and centralized error handling. */
// Next validates exported route signatures per route; `any` params lets one wrapper serve routes with and without dynamic segments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteExport = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<Response>;
export function handler(fn: Handler, opts: { public?: boolean; admin?: boolean } = {}): RouteExport {
  return async (req, ctx) => {
    try {
      if (!opts.public) {
        if (opts.admin) await requireAdmin(); else await requireUser();
      }
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json<ApiResponse<never>>({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json<ApiResponse<never>>({ ok: false, error: { code: "VALIDATION", message: "Invalid input", details: e.flatten() } }, { status: 400 });
      if (e instanceof SyntaxError) return NextResponse.json<ApiResponse<never>>({ ok: false, error: { code: "BAD_JSON", message: "Request body must be valid JSON" } }, { status: 400 });
      if (e instanceof Prisma.PrismaClientInitializationError || (e instanceof Prisma.PrismaClientKnownRequestError && ["P1001", "P1002", "P1017"].includes(e.code))) {
        console.error(`[api] ${req.method} ${req.nextUrl.pathname} database unavailable`);
        return NextResponse.json<ApiResponse<never>>({ ok: false, error: { code: "DATABASE_UNAVAILABLE", message: "The database is not reachable. Check the postgres service (./scripts/netmon.sh health)." } }, { status: 503 });
      }
      // Log the server-side detail, never return it: clients only ever see a generic message.
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, e instanceof Error ? e.message : e);
      return NextResponse.json<ApiResponse<never>>({ ok: false, error: { code: "INTERNAL", message: "Internal server error" } }, { status: 500 });
    }
  };
}
