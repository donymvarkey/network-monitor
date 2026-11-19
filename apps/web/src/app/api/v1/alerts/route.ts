import { alertListSchema } from "@netmon/shared-validation";
import type { Prisma } from "@prisma/client";
import { handler, ok, parsePagination } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async (req) => {
  const { page, pageSize } = parsePagination(req);
  const q = alertListSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const where: Prisma.AlertWhereInput = {
    ...(q.state === "active" ? { state: { in: ["OPEN", "ACKNOWLEDGED"] } } : q.state === "all" ? {} : { state: q.state }),
    ...(q.severity && { severity: q.severity }),
  };
  const [items, total, counts] = await Promise.all([
    prisma.alert.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { triggeredAt: "desc" },
      include: { rule: { select: { id: true, name: true, type: true } }, device: { select: { id: true, displayName: true, hostname: true } }, acknowledgedBy: { select: { email: true } } } }),
    prisma.alert.count({ where }),
    prisma.alert.groupBy({ by: ["state"], _count: true }),
  ]);
  const ids = [...new Set(items.flatMap((a) => (a.networkId ? [a.networkId] : [])))];
  const nets = new Map((await prisma.network.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((n) => [n.id, n.name]));
  return ok({ items: items.map((a) => ({ ...a, networkName: a.networkId ? nets.get(a.networkId) ?? null : null })), counts: Object.fromEntries(counts.map((c) => [c.state, c._count])) }, { page, pageSize, total });
});
