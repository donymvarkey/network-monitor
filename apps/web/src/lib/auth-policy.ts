/** Pure session/role rules (unit-tested without Next or a database). */
export type Role = "ADMIN" | "VIEWER";
export interface SessionLike { userId?: string; role?: Role; ver?: number; iat?: number; seen?: number }
export interface UserLike { id: string; role: Role; sessionVersion: number; disabled: boolean }

export type SessionVerdict = { ok: true; role: Role; refresh: boolean } | { ok: false; reason: "NO_SESSION" | "EXPIRED" | "IDLE" | "REVOKED" | "DISABLED" };

export function checkSession(s: SessionLike, user: UserLike | null, nowSec: number, maxAgeSec: number, idleSec: number): SessionVerdict {
  if (!s.userId || !s.iat) return { ok: false, reason: "NO_SESSION" };
  if (!user) return { ok: false, reason: "REVOKED" };
  if (user.disabled) return { ok: false, reason: "DISABLED" };
  if ((s.ver ?? 0) !== user.sessionVersion) return { ok: false, reason: "REVOKED" };
  if (nowSec - s.iat > maxAgeSec) return { ok: false, reason: "EXPIRED" };
  if (s.seen && nowSec - s.seen > idleSec) return { ok: false, reason: "IDLE" };
  // Role always comes from the database, never from the cookie, so demotions apply immediately.
  return { ok: true, role: user.role, refresh: !s.seen || nowSec - s.seen > 60 };
}

export function canWrite(role: Role): boolean { return role === "ADMIN"; }
