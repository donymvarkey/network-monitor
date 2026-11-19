import { channelPatchSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export const PATCH = handler(async (req, { params }) => {
  const { id } = await params;
  const user = await requireAdmin();
  const { recipients, ...b } = channelPatchSchema.parse(await req.json());
  const cur = await prisma.notificationChannel.findUnique({ where: { id } });
  if (!cur) throw new ApiError(404, "NOT_FOUND", "Channel not found");
  const ch = await prisma.notificationChannel.update({ where: { id }, data: { ...b, ...(recipients && { config: { ...(cur.config as object), recipients } }) } });
  await audit("notification_channel.update", { userId: user.userId, target: id });
  return ok(ch);
}, { admin: true });

export const DELETE = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireAdmin();
  await prisma.notificationChannel.delete({ where: { id } }).catch(() => { throw new ApiError(404, "NOT_FOUND", "Channel not found"); });
  await audit("notification_channel.delete", { userId: user.userId, target: id });
  return ok(null);
}, { admin: true });
