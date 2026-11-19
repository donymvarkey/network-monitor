import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Everything on the overview comes from stored records; null means "no data", never a guess. */
export async function getDashboard() {
  const since = new Date(Date.now() - 15 * 60_000);
  const [statuses, routers, networks, collectors, lat, latest, discovered, disconnected, routerEvents, alerts, networkChanges] = await Promise.all([
    prisma.device.groupBy({ by: ["status"], where: { mergedIntoId: null }, _count: true }),
    prisma.router.groupBy({ by: ["status"], _count: true }),
    prisma.network.count(),
    prisma.collector.findMany({ select: { id: true, name: true, status: true, lastSeenAt: true }, orderBy: { name: "asc" } }),
    prisma.latencyMeasurement.aggregate({ where: { measuredAt: { gte: since } }, _avg: { avgMs: true, packetLoss: true }, _count: true }),
    prisma.networkHealthSnapshot.findFirst({ where: { networkId: null }, orderBy: { takenAt: "desc" } }),
    prisma.device.findMany({ where: { mergedIntoId: null }, orderBy: { firstSeenAt: "desc" }, take: 6, select: { id: true, displayName: true, hostname: true, vendor: true, firstSeenAt: true, network: { select: { name: true } } } }),
    prisma.deviceStatusTransition.findMany({ where: { toStatus: "OFFLINE" }, orderBy: { occurredAt: "desc" }, take: 6, select: { id: true, occurredAt: true, reason: true, device: { select: { id: true, displayName: true, hostname: true } } } }),
    prisma.networkEvent.findMany({ where: { type: { startsWith: "router." } }, orderBy: { occurredAt: "desc" }, take: 6 }),
    prisma.alert.findMany({ orderBy: { triggeredAt: "desc" }, take: 6, select: { id: true, title: true, severity: true, state: true, triggeredAt: true } }),
    prisma.networkEvent.findMany({ where: { OR: [{ type: { startsWith: "network." } }, { type: { startsWith: "scan." } }, { type: { startsWith: "collector." } }] }, orderBy: { occurredAt: "desc" }, take: 6 }),
  ]);
  const c = (s: string) => statuses.find((x) => x.status === s)?._count ?? 0;
  const routersTotal = routers.reduce((a, r) => a + r._count, 0);
  const routersUp = routers.find((r) => r.status === "ONLINE")?._count ?? 0;
  const collectorsUp = collectors.filter((x) => x.status === "CONNECTED").length;
  return {
    summary: {
      total: c("ONLINE") + c("OFFLINE") + c("UNKNOWN"), online: c("ONLINE"), offline: c("OFFLINE"), unknown: c("UNKNOWN"),
      activeRouters: routersUp, routersTotal, networks, collectorsConnected: collectorsUp, collectorsDisconnected: collectors.length - collectorsUp,
    },
    health: {
      avgLatencyMs: lat._count ? lat._avg.avgMs : null,
      packetLoss: lat._count ? lat._avg.packetLoss : null,
      measurements15m: lat._count,
      routerAvailability: routersTotal ? routersUp / routersTotal : null,
      collectorAvailability: collectors.length ? collectorsUp / collectors.length : null,
      healthScore: latest?.healthScore ?? null,
      healthAt: latest?.takenAt.toISOString() ?? null,
    },
    collectors: collectors.map((x) => ({ ...x, lastSeenAt: x.lastSeenAt?.toISOString() ?? null })),
    recent: {
      discovered: discovered.map((d) => ({ ...d, firstSeenAt: d.firstSeenAt.toISOString() })),
      disconnected: disconnected.map((t) => ({ ...t, occurredAt: t.occurredAt.toISOString() })),
      routerEvents: routerEvents.map(ev), alerts: alerts.map((a) => ({ ...a, triggeredAt: a.triggeredAt.toISOString() })), networkChanges: networkChanges.map(ev),
    },
  };
}
const ev = (e: { id: string; type: string; severity: string; message: string; occurredAt: Date }) => ({ id: e.id, type: e.type, severity: e.severity, message: e.message, occurredAt: e.occurredAt.toISOString() });
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

const RANGES = { "24h": { hours: 24, unit: "hour" }, "7d": { hours: 168, unit: "hour" }, "30d": { hours: 720, unit: "day" } } as const;
export type ChartRange = keyof typeof RANGES;

/** Bucketed series from snapshots and hourly rollups. At most ~170 points per series reach the browser. */
export async function getCharts(range: ChartRange, networkId: string | null = null) {
  const { hours, unit } = RANGES[range];
  const since = new Date(Date.now() - hours * 3600_000);
  const net = networkId ? Prisma.sql`"networkId" = ${networkId}::uuid` : Prisma.sql`"networkId" IS NULL`;
  const health = await prisma.$queryRaw<{ t: Date; total: number; online: number; offline: number; unknown: number; routers_total: number; routers_up: number; health: number | null }[]>`
    SELECT date_trunc(${unit}, "takenAt") AS t, round(avg("devicesTotal"))::int AS total, round(avg(online))::int AS online,
           round(avg(offline))::int AS offline, round(avg(unknown))::int AS unknown,
           round(avg("routersTotal"))::int AS routers_total, avg("routersUp")::float AS routers_up, avg("healthScore")::float AS health
    FROM "NetworkHealthSnapshot" WHERE ${net} AND "takenAt" >= ${since} GROUP BY 1 ORDER BY 1`;
  const latNet = networkId ? Prisma.sql`AND "networkId" = ${networkId}::uuid` : Prisma.empty;
  const latency = await prisma.$queryRaw<{ t: Date; avg: number | null; min: number | null; max: number | null; loss: number | null; avail: number | null }[]>`
    SELECT date_trunc(${unit}, "bucketStart") AS t,
           (sum("avgMs" * "upSamples") / NULLIF(sum("upSamples") FILTER (WHERE "avgMs" IS NOT NULL), 0))::float AS avg,
           min("minMs")::float AS min, max("maxMs")::float AS max,
           (sum("packetLoss" * samples) / NULLIF(sum(samples), 0))::float AS loss,
           (sum("upSamples")::float / NULLIF(sum(samples), 0))::float AS avail
    FROM "LatencyRollup" WHERE "bucketStart" >= ${since} ${latNet} GROUP BY 1 ORDER BY 1`;
  return {
    range,
    health: health.map((h) => ({
      t: h.t.toISOString(), total: h.total, online: h.online, offline: h.offline, unknown: h.unknown, health: h.health,
      availability: h.online + h.offline ? h.online / (h.online + h.offline) : null,
      routerAvailability: h.routers_total ? h.routers_up / h.routers_total : null,
    })),
    latency: latency.map((l) => ({ t: l.t.toISOString(), avg: l.avg, min: l.min, max: l.max, loss: l.loss, availability: l.avail })),
  };
}
export type Charts = Awaited<ReturnType<typeof getCharts>>;
