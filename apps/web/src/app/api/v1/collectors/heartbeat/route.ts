import { heartbeatSchema } from "@netmon/shared-validation";
import { handler, ok } from "@/lib/api";
import { requireCollector } from "@/lib/collector-auth";
import { prisma } from "@/lib/prisma";
import { publishEvent } from "@/lib/redis";

/**
 * Heartbeat also delivers dispatched scan jobs and pending monitoring rounds
 * (pull model: the collector never needs inbound ports). No monitoring loop runs here —
 * tasks are created by the worker; this only hands them over.
 */
export const POST = handler(async (req) => {
  const c = await requireCollector(req);
  const body = heartbeatSchema.parse(await req.json());
  const wasDisconnected = c.status === "DISCONNECTED";
  const wasConnected = c.status === "CONNECTED";
  await prisma.collector.update({ where: { id: c.id }, data: { lastSeenAt: new Date(), version: body.version, status: "CONNECTED" } });
  if (!wasConnected) {
    await prisma.networkEvent.create({ data: { networkId: c.networkId, type: wasDisconnected ? "collector.reconnected" : "collector.connected", message: `Collector ${c.name} ${wasDisconnected ? "reconnected" : "connected"}`, data: { collectorId: c.id } } });
    await publishEvent("collector:connected", { collectorId: c.id });
    if (wasDisconnected) await publishEvent("collector:reconnected", { collectorId: c.id });
    await publishEvent("network:event", { category: "collector" });
  }
  const now = new Date();
  const [pending, links, tasks] = await Promise.all([
    prisma.scanJob.findMany({ where: { collectorId: c.id, status: { in: ["DISPATCHED", "QUEUED"] } }, include: { network: { select: { cidr: true } } } }),
    prisma.collectorNetwork.findMany({ where: { collectorId: c.id }, include: { network: { select: { cidr: true } } } }),
    prisma.monitorTask.findMany({ where: { collectorId: c.id, status: "PENDING", expiresAt: { gt: now } }, take: 20 }),
  ]);
  if (tasks.length) await prisma.monitorTask.updateMany({ where: { id: { in: tasks.map((t) => t.id) }, status: "PENDING" }, data: { status: "DISPATCHED", dispatchedAt: now } });
  return ok({
    scans: pending.map((s) => ({ scanJobId: s.id, cidr: s.network.cidr })),
    assignments: links.map((l) => ({ cidr: l.network.cidr, primary: l.isPrimary })),
    monitors: tasks.map((t) => ({ monitorTaskId: t.id, targets: t.targets as string[], pingCount: t.pingCount, timeoutMs: t.timeoutMs })),
  });
}, { public: true });
