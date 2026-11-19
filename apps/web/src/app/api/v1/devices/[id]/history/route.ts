import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  const [addresses, transitions, observations, events, collectors] = await Promise.all([
    prisma.deviceAddress.findMany({ where: { deviceId: id }, orderBy: { validFrom: "desc" }, take: 100 }),
    prisma.deviceStatusTransition.findMany({ where: { deviceId: id }, orderBy: { occurredAt: "desc" }, take: 100 }),
    prisma.deviceObservation.findMany({ where: { deviceId: id }, orderBy: { observedAt: "desc" }, take: 50, select: { id: true, method: true, source: true, ipAddress: true, macAddress: true, hostname: true, reachable: true, latencyMs: true, observedAt: true, collectorId: true } }),
    prisma.networkEvent.findMany({ where: { deviceId: id }, orderBy: { occurredAt: "desc" }, take: 100, select: { id: true, type: true, severity: true, message: true, occurredAt: true } }),
    prisma.collector.findMany({ select: { id: true, name: true } }),
  ]);
  const cn = new Map(collectors.map((c) => [c.id, c.name]));
  return ok({ addresses, transitions, events, observations: observations.map((o) => ({ ...o, collectorName: cn.get(o.collectorId) ?? null })) });
});
