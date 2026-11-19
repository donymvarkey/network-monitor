import { deviceListQuery } from "@netmon/shared-validation";
import type { Prisma } from "@prisma/client";
import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async (req) => {
  const q = deviceListQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const where: Prisma.DeviceWhereInput = {
    mergedIntoId: null,
    ...(q.status && { status: q.status }),
    ...(q.networkId && { networkId: q.networkId }),
    ...(q.collectorId && { lastCollectorId: q.collectorId }),
    ...(q.category && { category: q.category }),
    ...(q.q && {
      OR: [
        { displayName: { contains: q.q, mode: "insensitive" } },
        { hostname: { contains: q.q, mode: "insensitive" } },
        { vendor: { contains: q.q, mode: "insensitive" } },
        { identifiers: { some: { value: { contains: q.q.toLowerCase() } } } },
      ],
    }),
  };
  const sortKey = (q.sort ?? "-lastSeenAt").replace("-", "");
  const dir = q.sort?.startsWith("-") ?? true ? "desc" : "asc";
  const orderBy: Prisma.DeviceOrderByWithRelationInput =
    sortKey === "name" ? { displayName: dir } : sortKey === "status" ? { status: dir } : sortKey === "vendor" ? { vendor: dir } : { lastSeenAt: { sort: dir, nulls: "last" } };
  const [rows, total, collectors] = await Promise.all([
    prisma.device.findMany({
      where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: {
        network: { select: { id: true, name: true, cidr: true } },
        identifiers: { where: { type: "MAC" }, select: { value: true, confidence: true } },
        addresses: { where: { validTo: null }, select: { address: true }, take: 1, orderBy: { validFrom: "desc" } },
      },
    }),
    prisma.device.count({ where }),
    prisma.collector.findMany({ select: { id: true, name: true } }),
  ]);
  const cname = new Map(collectors.map((c) => [c.id, c.name]));
  const data = rows.map((d) => ({
    id: d.id,
    name: d.displayName ?? d.hostname ?? null,
    hostname: d.hostname,
    ip: d.addresses[0]?.address ?? null,
    mac: d.identifiers[0]?.value ?? null,
    macRandomized: (d.identifiers[0]?.confidence ?? 100) < 100,
    vendor: d.vendor, deviceType: d.deviceType, category: d.category,
    network: d.network, status: d.status, lastSeenAt: d.lastSeenAt,
    collector: d.lastCollectorId ? { id: d.lastCollectorId, name: cname.get(d.lastCollectorId) ?? null } : null,
  }));
  return ok(data, { page: q.page, pageSize: q.pageSize, total });
});
