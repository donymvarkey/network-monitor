import { alertActionSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { publishEvent } from "@/lib/redis";
import { audit } from "@/lib/audit";

/** Acknowledge or manually resolve. A manually resolved alert re-opens on the next evaluation if still breached. */
export const PATCH = handler(async (req, { params }) => {
  const { id } = await params;
  const user = await requireAdmin();
  const { action } = alertActionSchema.parse(await req.json());
  const a = await prisma.alert.findUnique({ where: { id } });
  if (!a) throw new ApiError(404, "NOT_FOUND", "Alert not found");
  if (a.state === "RESOLVED") throw new ApiError(409, "ALREADY_RESOLVED", "Alert is already resolved");
  const now = new Date();
  const updated = await prisma.alert.update({ where: { id }, data: action === "acknowledge"
    ? { state: "ACKNOWLEDGED", acknowledgedById: user.userId, acknowledgedAt: now }
    : { state: "RESOLVED", resolvedAt: now, details: { ...((a.details as object) ?? {}), resolvedBy: user.userId, resolvedManually: true } } });
  await audit(`alert.${action}`, { userId: user.userId, target: id });
  await publishEvent("alert:updated", { alertId: id, state: updated.state });
  return ok(updated);
});
