import "server-only";
import { getSession, SESSION_IDLE_SEC, SESSION_MAX_AGE_SEC } from "./session";
import { prisma } from "./prisma";
import { checkSession, type Role } from "./auth-policy";

/** Read-only session check for server components (they cannot modify cookies). */
export async function currentUser(): Promise<{ userId: string; role: Role; email: string } | null> {
  const s = await getSession();
  if (!s.userId) return null;
  const user = await prisma.user.findUnique({ where: { id: s.userId }, select: { id: true, role: true, sessionVersion: true, disabled: true, email: true } });
  const v = checkSession(s, user, Math.floor(Date.now() / 1000), SESSION_MAX_AGE_SEC, SESSION_IDLE_SEC);
  return v.ok && user ? { userId: user.id, role: v.role, email: user.email } : null;
}
