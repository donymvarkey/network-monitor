import { ApiError, handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Delivery status of one notification (used by "send test"). */
export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  const n = await prisma.notification.findUnique({ where: { id }, select: { id: true, type: true, status: true, attempts: true, error: true, sentAt: true, createdAt: true } });
  if (!n) throw new ApiError(404, "NOT_FOUND", "Notification not found");
  return ok(n);
});
