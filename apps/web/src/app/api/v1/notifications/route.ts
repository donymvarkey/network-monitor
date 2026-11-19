import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** In-app notifications (bell). Shared across users of this single-household installation. */
export const GET = handler(async () => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { type: "IN_APP" }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, alertId: true, kind: true, title: true, readAt: true, createdAt: true } }),
    prisma.notification.count({ where: { type: "IN_APP", readAt: null } }),
  ]);
  return ok({ items, unread });
});
