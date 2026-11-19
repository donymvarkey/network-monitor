import { QUEUE_NOTIFY } from "@netmon/network-core";
import { ApiError, handler, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getQueue } from "@/lib/redis";
import { rateLimit } from "@/lib/rate-limit";

/** Queues a real test message through the same delivery path alerts use; the result shows in the channel's history. */
export const POST = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireAdmin();
  if (!(await rateLimit(`notify-test:${user.userId}`, 5, 300))) throw new ApiError(429, "RATE_LIMITED", "Too many test messages, wait a few minutes");
  const ch = await prisma.notificationChannel.findUnique({ where: { id } });
  if (!ch) throw new ApiError(404, "NOT_FOUND", "Channel not found");
  const n = await prisma.notification.create({ data: { channelId: ch.id, type: ch.type, kind: "test", title: "Test notification", body: `This is a test message from NetWatch sent at ${new Date().toISOString()}.` } });
  await getQueue(QUEUE_NOTIFY).add("deliver", { notificationId: n.id }, { jobId: `notify-${n.id}`, attempts: 1, removeOnComplete: true, removeOnFail: 50 });
  return ok({ notificationId: n.id });
}, { admin: true });
