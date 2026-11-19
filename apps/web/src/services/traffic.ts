import "server-only";
import { Prisma } from "@prisma/client";
import { TRAFFIC_RANGES, type TrafficRange } from "@netmon/network-core";
import { prisma } from "@/lib/prisma";

/**
 * Traffic analytics read model. Rules:
 *  - null always means "not measured" and is rendered as Unavailable, never as 0.
 *  - Totals come only from WAN-interface samples (router counters). LAN interfaces are shown for utilisation only.
 *  - Per-device numbers come only from per-device sources (NetFlow, router client statistics). Aggregate router
 *    traffic is never split across devices.
 */
const n = (v: bigint | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

function table(range: TrafficRange) {
  const r = TRAFFIC_RANGES[range];
  return r.rollup
    ? { t: Prisma.raw(`"TrafficRollup"`), at: Prisma.raw(`"bucketStart"`), down: Prisma.raw(`"maxDownloadBps"`), up: Prisma.raw(`"maxUploadBps"`) }
    : { t: Prisma.raw(`"TrafficSample"`), at: Prisma.raw(`"measuredAt"`), down: Prisma.raw(`"downloadBps"`), up: Prisma.raw(`"uploadBps"`) };
}

type Totals = { download: bigint | null; upload: bigint | null; samples: bigint };

export const SOURCE_KINDS = [
  { kind: "SNMP_IF_COUNTERS", label: "SNMP interface counters", perDevice: false, howTo: "Add a router with SNMP v2c/v3 integration. Gives per-interface totals (WAN/LAN), not per-device." },
  { kind: "ROUTER_CLIENT_STATS", label: "Router client statistics", perDevice: true, howTo: "Only when the router API reports per-client byte counters. The D-Link HNAP and standard SNMP MIBs do not." },
  { kind: "NETFLOW_V5", label: "NetFlow v5", perDevice: true, howTo: "Set ENABLE_NETFLOW=true on a collector and point the router/switch flow export at it (UDP 2055)." },
  { kind: "IPFIX", label: "IPFIX", perDevice: true, howTo: "Not decoded in this version. Datagrams are detected and reported here." },
  { kind: "SFLOW", label: "sFlow", perDevice: true, howTo: "Not implemented in this version." },
  { kind: "PACKET_CAPTURE", label: "Packet capture", perDevice: true, howTo: "Disabled. Packet contents are never captured; no legitimate diagnostic mode is configured." },
] as const;

export async function getTrafficSources() {
  const [sources, routers] = await Promise.all([
    prisma.trafficSource.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], include: { router: { select: { id: true, name: true } }, collector: { select: { id: true, name: true } } } }),
    prisma.router.findMany({ select: { id: true, name: true, integrationMethod: true, capabilities: { where: { capability: { in: ["interfaceStats", "clientTraffic"] } }, select: { capability: true, state: true, detail: true } } } }),
  ]);
  return {
    kinds: SOURCE_KINDS.map((k) => ({ ...k, configured: sources.filter((s) => s.kind === k.kind).length, active: sources.filter((s) => s.kind === k.kind && s.status === "ACTIVE").length })),
    sources: sources.map((s) => ({ id: s.id, kind: s.kind, name: s.name, status: s.status, detail: s.detail, perDevice: s.perDevice, lastSampleAt: s.lastSampleAt?.toISOString() ?? null, router: s.router, collector: s.collector })),
    routers: routers.map((r) => ({ id: r.id, name: r.name, method: r.integrationMethod, capabilities: r.capabilities })),
  };
}

export async function getTraffic(range: TrafficRange, networkId?: string) {
  const r = TRAFFIC_RANGES[range];
  const since = new Date(Date.now() - r.ms);
  const { t, at, down, up } = table(range);
  const net = networkId ? Prisma.sql`AND "networkId" = ${networkId}::uuid` : Prisma.empty;
  const bucket = Prisma.sql`to_timestamp(floor(extract(epoch from ${at}) / ${r.bucketSec}) * ${r.bucketSec})`;

  const [totals, devTotals, series, devSeries, byDevice, byNetwork, byRouter, current, last, sources, interfaces] = await Promise.all([
    prisma.$queryRaw<Totals[]>`SELECT sum("downloadBytes")::bigint AS download, sum("uploadBytes")::bigint AS upload, count(*)::bigint AS samples FROM ${t} WHERE "countsTowardTotal" AND ${at} >= ${since} ${net}`,
    prisma.$queryRaw<Totals[]>`SELECT sum("downloadBytes")::bigint AS download, sum("uploadBytes")::bigint AS upload, count(*)::bigint AS samples FROM ${t} WHERE scope = 'DEVICE' AND ${at} >= ${since} ${net}`,
    prisma.$queryRaw<{ b: Date; down: bigint; up: bigint }[]>`SELECT ${bucket} AS b, sum("downloadBytes")::bigint AS down, sum("uploadBytes")::bigint AS up FROM ${t} WHERE "countsTowardTotal" AND ${at} >= ${since} ${net} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ b: Date; down: bigint; up: bigint }[]>`SELECT ${bucket} AS b, sum("downloadBytes")::bigint AS down, sum("uploadBytes")::bigint AS up FROM ${t} WHERE scope = 'DEVICE' AND ${at} >= ${since} ${net} GROUP BY 1 ORDER BY 1`,
    // One source per device (the one that saw the most bytes) so two sources for the same host are never added together.
    prisma.$queryRaw<{ deviceId: string; sourceId: string; down: bigint; up: bigint; peakDown: number; peakUp: number; lastAt: Date }[]>`
      SELECT DISTINCT ON ("deviceId") "deviceId", "sourceId", down, up, "peakDown", "peakUp", "lastAt" FROM (
        SELECT "deviceId", "sourceId", sum("downloadBytes")::bigint AS down, sum("uploadBytes")::bigint AS up, max(${down}) AS "peakDown", max(${up}) AS "peakUp", max(${at}) AS "lastAt"
        FROM ${t} WHERE scope = 'DEVICE' AND ${at} >= ${since} ${net} GROUP BY 1, 2) x
      ORDER BY "deviceId", (down + up) DESC`,
    prisma.$queryRaw<{ networkId: string; down: bigint; up: bigint; perDevice: boolean }[]>`SELECT "networkId", sum("downloadBytes")::bigint AS down, sum("uploadBytes")::bigint AS up, (scope = 'DEVICE') AS "perDevice" FROM ${t} WHERE ("countsTowardTotal" OR scope = 'DEVICE') AND "networkId" IS NOT NULL AND ${at} >= ${since} ${net} GROUP BY 1, 4`,
    prisma.$queryRaw<{ routerId: string; down: bigint; up: bigint }[]>`SELECT "routerId", sum("downloadBytes")::bigint AS down, sum("uploadBytes")::bigint AS up FROM ${t} WHERE "countsTowardTotal" AND "routerId" IS NOT NULL AND ${at} >= ${since} ${net} GROUP BY 1`,
    // Current rate: latest WAN sample per interface within the last 10 minutes.
    prisma.$queryRaw<{ down: number | null; up: number | null; n: bigint }[]>`SELECT sum("downloadBps") AS down, sum("uploadBps") AS up, count(*)::bigint AS n FROM (
        SELECT DISTINCT ON ("interfaceId") "downloadBps", "uploadBps" FROM "TrafficSample" WHERE "countsTowardTotal" AND "measuredAt" >= now() - interval '10 minutes' ${net} ORDER BY "interfaceId", "measuredAt" DESC) x`,
    prisma.trafficSample.findFirst({ where: networkId ? { networkId } : {}, orderBy: { measuredAt: "desc" }, select: { measuredAt: true } }),
    getTrafficSources(),
    prisma.$queryRaw<{ id: string; name: string; role: string; speedMbps: number | null; routerId: string; routerName: string; downloadBps: number | null; uploadBps: number | null; utilization: number | null; measuredAt: Date | null }[]>`
      SELECT i.id, i.name, i.role, i."speedMbps", r.id AS "routerId", r.name AS "routerName", s."downloadBps", s."uploadBps", s.utilization, s."measuredAt"
      FROM "RouterInterface" i JOIN "Router" r ON r.id = i."routerId"
      LEFT JOIN LATERAL (SELECT "downloadBps", "uploadBps", utilization, "measuredAt" FROM "TrafficSample" WHERE "interfaceId" = i.id ORDER BY "measuredAt" DESC LIMIT 1) s ON true
      WHERE ${networkId ? Prisma.sql`r."networkId" = ${networkId}::uuid` : Prisma.sql`true`} ORDER BY r.name, i.role, i.name`,
  ]);

  const ids = [...new Set([...byDevice.map((d) => d.deviceId)])];
  const [devices, networks, routers, srcs] = await Promise.all([
    prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, hostname: true, vendor: true, category: true, network: { select: { name: true } } } }),
    prisma.network.findMany({ where: { id: { in: [...new Set(byNetwork.map((x) => x.networkId))] } }, select: { id: true, name: true, cidr: true } }),
    prisma.router.findMany({ where: { id: { in: byRouter.map((x) => x.routerId) } }, select: { id: true, name: true } }),
    prisma.trafficSource.findMany({ where: { id: { in: [...new Set(byDevice.map((d) => d.sourceId))] } }, select: { id: true, kind: true, name: true } }),
  ]);
  const dm = new Map(devices.map((d) => [d.id, d])), nm = new Map(networks.map((x) => [x.id, x])), rm = new Map(routers.map((x) => [x.id, x])), sm = new Map(srcs.map((x) => [x.id, x]));

  // Fill every bucket in the range so a missing interval is drawn as a gap (null), not as zero.
  const step = r.bucketSec * 1000;
  const startB = Math.floor(since.getTime() / step) * step;
  const toMap = (rows: { b: Date; down: bigint; up: bigint }[]) => new Map(rows.map((x) => [x.b.getTime(), x]));
  const wm = toMap(series), dsm = toMap(devSeries);
  const points: { t: string; down: number | null; up: number | null; devDown: number | null; devUp: number | null }[] = [];
  for (let b = startB; b <= Date.now(); b += step) {
    const w = wm.get(b), d = dsm.get(b);
    points.push({ t: new Date(b).toISOString(), down: w ? Number(w.down) * 8 / r.bucketSec : null, up: w ? Number(w.up) * 8 / r.bucketSec : null, devDown: d ? Number(d.down) * 8 / r.bucketSec : null, devUp: d ? Number(d.up) * 8 / r.bucketSec : null });
  }

  const tot = totals[0]!, dt = devTotals[0]!, cur = current[0]!;
  const deviceRows = byDevice.map((d) => {
    const dev = dm.get(d.deviceId), s = sm.get(d.sourceId);
    return { deviceId: d.deviceId, name: dev?.displayName ?? dev?.hostname ?? "Unnamed device", vendor: dev?.vendor ?? null, network: dev?.network.name ?? null, download: Number(d.down), upload: Number(d.up), total: Number(d.down) + Number(d.up), peakDownBps: d.peakDown, peakUpBps: d.peakUp, lastAt: d.lastAt.toISOString(), source: s ? { kind: s.kind, name: s.name } : null };
  }).sort((a, b) => b.total - a.total);

  return {
    range, bucketSec: r.bucketSec,
    totals: {
      // WAN counters (router)
      download: Number(tot.samples) ? n(tot.download) : null, upload: Number(tot.samples) ? n(tot.upload) : null, wanSamples: Number(tot.samples),
      // Sum of measured per-device traffic (flow / client stats); a different view, never added to WAN totals
      deviceDownload: Number(dt.samples) ? n(dt.download) : null, deviceUpload: Number(dt.samples) ? n(dt.upload) : null, deviceSamples: Number(dt.samples),
    },
    current: { downloadBps: Number(cur.n) ? cur.down : null, uploadBps: Number(cur.n) ? cur.up : null, interfaces: Number(cur.n) },
    lastUpdated: last?.measuredAt.toISOString() ?? null,
    series: points,
    byDevice: deviceRows,
    top: deviceRows.slice(0, 10),
    byNetwork: byNetwork.map((x) => ({ networkId: x.networkId, name: nm.get(x.networkId)?.name ?? "Unknown", cidr: nm.get(x.networkId)?.cidr ?? null, perDevice: x.perDevice, download: Number(x.down), upload: Number(x.up) })),
    byRouter: byRouter.map((x) => ({ routerId: x.routerId, name: rm.get(x.routerId)?.name ?? "Unknown", download: Number(x.down), upload: Number(x.up) })),
    interfaces: interfaces.map((i) => ({ ...i, measuredAt: i.measuredAt?.toISOString() ?? null })),
    sources,
  };
}

/** Device traffic, with an explanation when nothing measured it. */
export async function getDeviceTraffic(deviceId: string, range: TrafficRange) {
  const r = TRAFFIC_RANGES[range];
  const since = new Date(Date.now() - r.ms);
  const { t, at } = table(range);
  const bucket = Prisma.sql`to_timestamp(floor(extract(epoch from ${at}) / ${r.bucketSec}) * ${r.bucketSec})`;
  const [bySource, series, latest, perDeviceSources, device] = await Promise.all([
    prisma.$queryRaw<{ sourceId: string; down: bigint; up: bigint; lastAt: Date }[]>`SELECT "sourceId", sum("downloadBytes")::bigint AS down, sum("uploadBytes")::bigint AS up, max(${at}) AS "lastAt" FROM ${t} WHERE "deviceId" = ${deviceId}::uuid AND ${at} >= ${since} GROUP BY 1 ORDER BY (sum("downloadBytes") + sum("uploadBytes")) DESC`,
    prisma.$queryRaw<{ b: Date; sourceId: string; down: bigint; up: bigint }[]>`SELECT ${bucket} AS b, "sourceId", sum("downloadBytes")::bigint AS down, sum("uploadBytes")::bigint AS up FROM ${t} WHERE "deviceId" = ${deviceId}::uuid AND ${at} >= ${since} GROUP BY 1, 2 ORDER BY 1`,
    prisma.trafficSample.findFirst({ where: { deviceId }, orderBy: { measuredAt: "desc" }, include: { source: { select: { kind: true, name: true } } } }),
    prisma.trafficSource.count({ where: { perDevice: true, status: "ACTIVE" } }),
    prisma.device.findUnique({ where: { id: deviceId }, select: { networkId: true } }),
  ]);
  const primary = bySource[0];
  const srcs = await prisma.trafficSource.findMany({ where: { id: { in: bySource.map((s) => s.sourceId) } }, select: { id: true, kind: true, name: true } });
  const sm = new Map(srcs.map((s) => [s.id, s]));
  const step = r.bucketSec * 1000, startB = Math.floor(since.getTime() / step) * step;
  const pm = new Map(series.filter((x) => x.sourceId === primary?.sourceId).map((x) => [x.b.getTime(), x]));
  const points = [];
  for (let b = startB; b <= Date.now(); b += step) { const p = pm.get(b); points.push({ t: new Date(b).toISOString(), down: p ? Number(p.down) * 8 / r.bucketSec : null, up: p ? Number(p.up) * 8 / r.bucketSec : null }); }

  let unavailableReason: string | null = null;
  if (!primary) {
    if (!perDeviceSources) unavailableReason = "No per-device traffic source is active. ARP and ICMP discovery only show that a device is present and reachable; they cannot measure bandwidth. Router interface counters measure the whole link and are not split across devices. Enable NetFlow on a collector, or use a router that reports per-client byte counters.";
    else if (latest) unavailableReason = `No traffic recorded for this device in the selected period (last measured ${latest.measuredAt.toISOString()}).`;
    else unavailableReason = "A per-device source is active, but it has not reported this device. Flow data is matched to a device only by its current IP address in a monitored network.";
  }
  const fresh = latest && Date.now() - latest.measuredAt.getTime() < 10 * 60_000;
  return {
    range, networkId: device?.networkId ?? null,
    available: !!primary,
    unavailableReason,
    usage: primary ? { download: Number(primary.down), upload: Number(primary.up), total: Number(primary.down) + Number(primary.up) } : null,
    otherSources: bySource.slice(1).map((s) => ({ source: sm.get(s.sourceId) ?? null, download: Number(s.down), upload: Number(s.up) })),
    current: fresh ? { downloadBps: latest!.downloadBps, uploadBps: latest!.uploadBps, measuredAt: latest!.measuredAt.toISOString() } : null,
    source: primary ? sm.get(primary.sourceId) ?? null : null,
    lastUpdated: latest?.measuredAt.toISOString() ?? null,
    series: points,
  };
}
export type Traffic = Awaited<ReturnType<typeof getTraffic>>;
export type DeviceTraffic = Awaited<ReturnType<typeof getDeviceTraffic>>;
export type TrafficSources = Awaited<ReturnType<typeof getTrafficSources>>;
