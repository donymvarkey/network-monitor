import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  const rows = await prisma.routerInterface.findMany({ where: { routerId: id }, orderBy: { ifIndex: "asc" }, include: { metrics: { orderBy: { timestamp: "desc" }, take: 2 } } });
  return ok(rows.map(({ metrics, ...i }) => {
    const [a, b] = metrics;
    const dt = a && b ? (a.timestamp.getTime() - b.timestamp.getTime()) / 1000 : 0;
    const rate = (x?: bigint | null, y?: bigint | null) => (dt > 0 && x != null && y != null && x >= y ? Number(x - y) * 8 / dt : null);
    return { ...i, rxBps: rate(a?.rxBytes, b?.rxBytes), txBps: rate(a?.txBytes, b?.txBytes), errors: a?.errors ?? null, sampledAt: a?.timestamp ?? null };
  }));
});
