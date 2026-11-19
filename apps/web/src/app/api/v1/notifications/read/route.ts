import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const POST = handler(async () => {
  const r = await prisma.notification.updateMany({ where: { type: "IN_APP", readAt: null }, data: { readAt: new Date() } });
  return ok({ marked: r.count });
});
