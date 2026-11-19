import { ingestTrafficSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok } from "@/lib/api";
import { requireCollector } from "@/lib/collector-auth";
import { prisma } from "@/lib/prisma";
import { publishEvent } from "@/lib/redis";

/**
 * Flow-based traffic ingestion (NetFlow v5 aggregated per host by the collector).
 * A host's bytes are attributed to a device only when its IP is the device's *current* address
 * in one of this collector's networks. Unmatched hosts are counted, never guessed.
 */
export const POST = handler(async (req) => {
  const c = await requireCollector(req);
  const body = ingestTrafficSchema.parse(await req.json());
  const start = new Date(body.intervalStart), end = new Date(body.intervalEnd);
  const secs = (end.getTime() - start.getTime()) / 1000;
  if (!(secs > 0 && secs <= 3600)) throw new ApiError(400, "VALIDATION", "Interval must be between 0 and 3600 seconds");

  const sourceKey = `collector:${c.id}:${body.exporterIp}`;
  const source = await prisma.trafficSource.upsert({
    where: { kind_sourceKey: { kind: "NETFLOW_V5", sourceKey } },
    update: { status: "ACTIVE", detail: null },
    create: { kind: "NETFLOW_V5", sourceKey, name: `NetFlow v5 from ${body.exporterIp}`, collectorId: c.id, perDevice: true },
  });
  // v9 / IPFIX datagrams arrived but are not decoded in this phase: record that so the UI says so.
  for (const v of body.unsupportedVersions) {
    const kind = v === 10 ? "IPFIX" : null;
    if (!kind) continue;
    await prisma.trafficSource.upsert({
      where: { kind_sourceKey: { kind, sourceKey } }, update: { status: "UNSUPPORTED", detail: "IPFIX datagrams received but this collector only decodes NetFlow v5" },
      create: { kind, sourceKey, name: `IPFIX from ${body.exporterIp}`, collectorId: c.id, perDevice: true, status: "UNSUPPORTED", detail: "IPFIX datagrams received but this collector only decodes NetFlow v5" },
    });
  }
  if (body.unsupportedVersions.includes(9) && !body.hosts.length)
    await prisma.trafficSource.update({ where: { id: source.id }, data: { status: "ERROR", detail: "Exporter is sending NetFlow v9; configure it for v5" } });

  const networkIds = (await prisma.collectorNetwork.findMany({ where: { collectorId: c.id }, select: { networkId: true } })).map((x) => x.networkId);
  if (c.networkId) networkIds.push(c.networkId);
  const ips = [...new Set(body.hosts.map((h) => h.ip))];
  const addrs = ips.length && networkIds.length ? await prisma.$queryRaw<{ deviceId: string; networkId: string; address: string }[]>`
    SELECT a."deviceId", a."networkId", host(a.address) AS address FROM "DeviceAddress" a JOIN "Device" d ON d.id = a."deviceId"
    WHERE a."networkId" = ANY(${[...new Set(networkIds)]}::uuid[]) AND a."validTo" IS NULL AND d."mergedIntoId" IS NULL AND host(a.address) = ANY(${ips})` : [];
  const byIp = new Map(addrs.map((a) => [a.address, a]));
  const rows = body.hosts.flatMap((h) => {
    const a = byIp.get(h.ip);
    if (!a) return [];
    return [{ sourceId: source.id, scope: "DEVICE" as const, deviceId: a.deviceId, networkId: a.networkId, countsTowardTotal: false,
      downloadBytes: BigInt(h.downloadBytes), uploadBytes: BigInt(h.uploadBytes), downloadBps: h.downloadBytes * 8 / secs, uploadBps: h.uploadBytes * 8 / secs, intervalSec: secs, measuredAt: end }];
  });
  if (rows.length) {
    await prisma.trafficSample.createMany({ data: rows });
    await prisma.trafficSource.update({ where: { id: source.id }, data: { lastSampleAt: end } });
    await publishEvent("traffic:updated", { sourceId: source.id });
  }
  return ok({ stored: rows.length, unmatched: body.hosts.length - rows.length });
}, { public: true });
