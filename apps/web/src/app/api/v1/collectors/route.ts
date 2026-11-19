import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async () => {
  const rows = await prisma.collector.findMany({
    orderBy: { createdAt: "asc" },
    include: { networks: { include: { network: { select: { id: true, name: true, cidr: true } } } } },
  });
  return ok(rows.map(({ tokenHash: _t, networks, ...c }) => ({ ...c, networks: networks.map((n) => ({ ...n.network, isPrimary: n.isPrimary })) })));
});
