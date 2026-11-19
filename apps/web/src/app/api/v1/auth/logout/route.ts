import { handler, ok } from "@/lib/api";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

/** POST /auth/logout ends this session; ?all=1 also invalidates every other session of the user. */
export const POST = handler(async (req) => {
  const s = await getSession();
  const userId = s.userId;
  const all = req.nextUrl.searchParams.get("all") === "1";
  if (userId && all) await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }).catch(() => undefined);
  s.destroy();
  if (userId) await audit(all ? "auth.logout_all" : "auth.logout", { userId });
  return ok(null);
}, { public: true });
