import { ApiError, handler, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { newCollectorToken } from "@/lib/collector-auth";
import { publishEvent } from "@/lib/redis";
import { audit } from "@/lib/audit";

/** Rotate: issues a new token (shown once), the old one stops working immediately. Also un-revokes. */
export const POST = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireAdmin();
  const c = await prisma.collector.findUnique({ where: { id } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Collector not found");
  const { token, tokenHash } = newCollectorToken();
  await prisma.collector.update({ where: { id }, data: { tokenHash, tokenRotatedAt: new Date(), revokedAt: null } });
  await audit("collector.token_rotated", { userId: user.userId, target: id });
  return ok({ collectorId: c.name, token });
}, { admin: true });

/** Revoke: the collector is rejected on every request until rotated. Its monitoring stops. */
export const DELETE = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireAdmin();
  const c = await prisma.collector.findUnique({ where: { id } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Collector not found");
  await prisma.$transaction([
    prisma.collector.update({ where: { id }, data: { revokedAt: new Date(), status: "DISCONNECTED" } }),
    prisma.scanJob.updateMany({ where: { collectorId: id, status: { in: ["QUEUED", "DISPATCHED", "RUNNING"] } }, data: { status: "CANCELLED", finishedAt: new Date() } }),
    prisma.networkEvent.create({ data: { networkId: c.networkId, type: "collector.revoked", severity: "WARNING", message: `Collector ${c.name} token revoked`, data: { collectorId: id } } }),
  ]);
  await audit("collector.token_revoked", { userId: user.userId, target: id });
  await publishEvent("collector:disconnected", { collectorId: id });
  return ok(null);
}, { admin: true });
