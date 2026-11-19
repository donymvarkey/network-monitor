import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
/** Monitoring engine status for Settings: per-network config, last round, recent job failures. */
export const GET = handler(async () => {
  const [networks, failures, tasks] = await Promise.all([
    prisma.network.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, cidr: true, monitorIntervalSec: true, pingCount: true, offlineThreshold: true, lastMonitoredAt: true, collectorLinks: { where: { isPrimary: true }, select: { collector: { select: { name: true, status: true } } } } } }),
    prisma.jobFailure.findMany({ orderBy: { failedAt: "desc" }, take: 25 }),
    prisma.monitorTask.groupBy({ by: ["status"], where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: true }),
  ]);
  return ok({
    networks: networks.map(({ collectorLinks, ...n }) => ({ ...n, primaryCollector: collectorLinks[0]?.collector ?? null })),
    failures,
    tasks24h: Object.fromEntries(tasks.map((t) => [t.status, t._count])),
  });
});
