import { collectorRegisterSchema } from "@netmon/shared-validation";
import { handler, ok } from "@/lib/api";
import { requireCollector } from "@/lib/collector-auth";
import { prisma } from "@/lib/prisma";
import { publishEvent } from "@/lib/redis";

/**
 * A collector reports the CIDRs it can see. It is linked only to networks in its own context
 * (X-Network-Context header, default = collector name) so two NATed LANs with the same range stay separate.
 * The first collector linked to a network becomes primary; others are standby (no duplicate periodic scans).
 */
export const POST = handler(async (req) => {
  const c = await requireCollector(req);
  const body = collectorRegisterSchema.parse(await req.json());
  const context = (req.headers.get("x-network-context") ?? c.name).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  await prisma.$transaction(async (tx) => {
    for (const cidr of body.cidrs) {
      const net = (await tx.network.findFirst({ where: { cidr, context } })) ?? (await tx.network.create({ data: { name: `${context} ${cidr}`, cidr, context } }));
      const hasPrimary = await tx.collectorNetwork.findFirst({ where: { networkId: net.id, isPrimary: true } });
      await tx.collectorNetwork.upsert({ where: { collectorId_networkId: { collectorId: c.id, networkId: net.id } }, update: {}, create: { collectorId: c.id, networkId: net.id, isPrimary: !hasPrimary } });
    }
    await tx.collector.update({ where: { id: c.id }, data: { version: body.version, hostname: body.hostname, status: "CONNECTED", lastSeenAt: new Date() } });
  });
  await publishEvent("collector:connected", { collectorId: c.id });
  return ok({ id: c.id, context });
}, { public: true });
