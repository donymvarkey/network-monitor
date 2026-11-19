import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Clients as reported by the router itself (if supported), linked to inventory devices by MAC. */
export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  const leases = await prisma.dHCPLease.findMany({ where: { routerId: id, leaseEnd: null }, orderBy: { leaseStart: "desc" }, take: 500 });
  const macs = [...new Set(leases.map((l) => l.macAddress))];
  const idents = await prisma.deviceIdentifier.findMany({ where: { type: "MAC", value: { in: macs } }, include: { device: { select: { id: true, displayName: true, hostname: true, status: true } } } });
  const byMac = new Map(idents.map((i) => [i.value, i.device]));
  return ok(leases.map((l) => ({ mac: l.macAddress, ip: l.address, hostname: l.hostname, since: l.leaseStart, device: byMac.get(l.macAddress) ?? null })));
});
