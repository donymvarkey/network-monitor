import { handler, ok, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async () => {
  const u = await requireUser();
  const user = await prisma.user.findUnique({ where: { id: u.userId }, select: { id: true, email: true, name: true, role: true, lastLoginAt: true } });
  return ok(user);
});
