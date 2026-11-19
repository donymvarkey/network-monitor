import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { env } from "./env";

/** ver = User.sessionVersion at login; iat/seen drive absolute and idle expiry (checked in requireUser). */
export interface SessionData { userId?: string; role?: "ADMIN" | "VIEWER"; ver?: number; iat?: number; seen?: number }

export const SESSION_MAX_AGE_SEC = Number(process.env.SESSION_MAX_AGE_HOURS ?? 12) * 3600;
export const SESSION_IDLE_SEC = Number(process.env.SESSION_IDLE_MINUTES ?? 120) * 60;

export const sessionOptions: SessionOptions = {
  cookieName: "netmon_session",
  password: env.SESSION_SECRET,
  ttl: SESSION_MAX_AGE_SEC,
  cookieOptions: {
    httpOnly: true, sameSite: "lax", path: "/",
    // COOKIE_SECURE=false only for plain-http LAN testing; HTTPS deployments keep it on.
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SEC,
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
