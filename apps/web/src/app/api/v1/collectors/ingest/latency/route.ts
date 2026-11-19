import { ingestLatencySchema } from "@netmon/shared-validation";
import { QUEUE_MONITOR_RESULTS } from "@netmon/network-core";
import { ApiError, handler, ok } from "@/lib/api";
import { assertCollectorNetwork, requireCollector } from "@/lib/collector-auth";
import { prisma } from "@/lib/prisma";
import { getQueue } from "@/lib/redis";

/**
 * Stores collector-measured latency/packet loss. Status evaluation (online/offline transitions,
 * events, realtime fan-out) is handed to the worker so request handling stays short.
 */
export const POST = handler(async (req) => {
  const c = await requireCollector(req);
  const { monitorTaskId, results } = ingestLatencySchema.parse(await req.json());
  const task = await prisma.monitorTask.findFirst({ where: { id: monitorTaskId, collectorId: c.id } });
  if (!task) throw new ApiError(404, "NOT_FOUND", "Unknown monitoring task");
  await assertCollectorNetwork(c.id, task.networkId); // assignment may have been removed since dispatch
  if (task.status === "COMPLETED") return ok({ stored: 0, unmatched: 0, duplicate: true });
  if (task.status === "EXPIRED") throw new ApiError(409, "EXPIRED", "Monitoring task expired before results arrived");

  // Map target IP -> device through the *current* address (validTo = null). IP is never identity on its own:
  // the address row was created by MAC-based discovery.
  const ips = [...new Set(results.map((r) => r.ip))];
  const addrs = ips.length ? await prisma.$queryRaw<{ deviceId: string; address: string }[]>`
    SELECT a."deviceId", host(a.address) AS address FROM "DeviceAddress" a JOIN "Device" d ON d.id = a."deviceId"
    WHERE a."networkId" = ${task.networkId}::uuid AND a."validTo" IS NULL AND d."mergedIntoId" IS NULL AND host(a.address) = ANY(${ips})` : [];
  const byIp = new Map(addrs.map((a) => [a.address, a.deviceId]));
  const rows = results.flatMap((r) => {
    const deviceId = byIp.get(r.ip);
    if (!deviceId) return [];
    return [{ deviceId, collectorId: c.id, networkId: task.networkId, monitorTaskId: task.id, targetIp: r.ip, sent: r.sent, received: r.received, minMs: r.minMs, avgMs: r.avgMs, maxMs: r.maxMs, packetLoss: (r.sent - r.received) / r.sent, measuredAt: new Date(r.measuredAt) }];
  });
  if (rows.length) await prisma.latencyMeasurement.createMany({ data: rows });
  await prisma.monitorTask.update({ where: { id: task.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await prisma.network.update({ where: { id: task.networkId }, data: { lastMonitoredAt: new Date() } });
  // jobId de-duplicates repeated uploads of the same round.
  await getQueue(QUEUE_MONITOR_RESULTS).add("evaluate", { monitorTaskId: task.id }, { jobId: `eval-${task.id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 1000 });
  return ok({ stored: rows.length, unmatched: results.length - rows.length });
}, { public: true });
