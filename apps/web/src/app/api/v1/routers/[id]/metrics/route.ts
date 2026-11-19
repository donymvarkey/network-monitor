import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async (req, { params }) => {
  const { id } = await params;
  const hours = Math.min(Number(req.nextUrl.searchParams.get("hours") ?? 24), 168);
  const rows = await prisma.routerMetric.findMany({ where: { routerId: id, timestamp: { gte: new Date(Date.now() - hours * 3600_000) } }, orderBy: { timestamp: "asc" } });
  return ok(rows.map((m) => ({ ...m, uptimeSec: m.uptimeSec === null ? null : Number(m.uptimeSec) })));
});
