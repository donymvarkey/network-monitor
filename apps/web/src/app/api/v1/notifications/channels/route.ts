import { channelSchema } from "@netmon/shared-validation";
import { handler, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

/** SMTP server settings live in the environment; only whether they are set is exposed (never the values). */
export const GET = handler(async () => {
  const channels = await prisma.notificationChannel.findMany({ orderBy: { createdAt: "asc" } });
  const last = await prisma.notification.groupBy({ by: ["channelId", "status"], where: { channelId: { in: channels.map((c) => c.id) }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true });
  return ok({
    smtp: { configured: !!process.env.SMTP_HOST && !!process.env.SMTP_FROM, host: process.env.SMTP_HOST ?? null, from: process.env.SMTP_FROM ?? null },
    implemented: ["IN_APP", "EMAIL"],
    channels: channels.map((c) => ({ ...c, stats7d: Object.fromEntries(last.filter((l) => l.channelId === c.id).map((l) => [l.status, l._count])) })),
  });
});

export const POST = handler(async (req) => {
  const user = await requireAdmin();
  const { recipients, ...b } = channelSchema.parse(await req.json());
  const ch = await prisma.notificationChannel.create({ data: { ...b, config: { recipients } } });
  await audit("notification_channel.create", { userId: user.userId, target: ch.id });
  return ok(ch);
}, { admin: true });
