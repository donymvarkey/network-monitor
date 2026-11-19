import { monitoringSettingsSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

/** Per-network monitoring interval / ping count / offline threshold. Takes effect on the worker's next tick. */
export const PATCH = handler(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const body = monitoringSettingsSchema.parse(await req.json());
  const n = await prisma.network.update({ where: { id }, data: body, select: { id: true, monitorIntervalSec: true, pingCount: true, offlineThreshold: true } })
    .catch(() => { throw new ApiError(404, "NOT_FOUND", "Network not found"); });
  await audit("network.monitoring_updated", { userId: user.userId, target: id, data: body });
  return ok(n);
}, { admin: true });
