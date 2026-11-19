import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/** Never let audit logging break a request: a stale session (user deleted after a reset) is recorded without userId. */
export async function audit(action: string, opts: { userId?: string; target?: string; ip?: string; userAgent?: string; data?: Prisma.InputJsonValue } = {}): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { action, ...opts } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003" && opts.userId) {
      const { userId, data, ...rest } = opts;
      const extra = data && typeof data === "object" && !Array.isArray(data) ? data : { value: data ?? null };
      await prisma.auditLog.create({ data: { action, ...rest, data: { ...extra, staleUserId: userId } } }).catch(() => {});
      return;
    }
    console.error("audit log failed", e);
  }
}
