import { networkUpsertSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, parsePagination, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export const GET = handler(async (req) => {
  const { page, pageSize } = parsePagination(req);
  const [rows, total] = await Promise.all([
    prisma.network.findMany({
      skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ context: "asc" }, { cidr: "asc" }],
      include: {
        routerLinks: { include: { router: { select: { id: true, name: true, status: true } } } },
        collectorLinks: { include: { collector: { select: { id: true, name: true, status: true } } } },
        scans: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true, finishedAt: true, devicesFound: true } },
        _count: { select: { devices: { where: { mergedIntoId: null } } } },
      },
    }),
    prisma.network.count(),
  ]);
  return ok(rows.map(({ routerLinks, collectorLinks, scans, _count, ...n }) => ({
    ...n, routers: routerLinks.map((l) => ({ ...l.router, role: l.role })), collectors: collectorLinks.map((l) => ({ ...l.collector, isPrimary: l.isPrimary })),
    deviceCount: _count.devices, lastScan: scans[0] ?? null,
  })), { page, pageSize, total });
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const { routerId, collectors, ...body } = networkUpsertSchema.parse(await req.json());
  const dup = await prisma.network.findFirst({ where: { context: body.context, cidr: body.cidr } });
  if (dup) throw new ApiError(409, "DUPLICATE", `${body.cidr} already exists in context "${body.context}". Use a different context for a separate network that reuses this range.`);
  const n = await prisma.$transaction(async (tx) => {
    const n = await tx.network.create({ data: body });
    if (routerId) await tx.routerNetwork.create({ data: { routerId, networkId: n.id } });
    for (const c of collectors ?? []) await tx.collectorNetwork.create({ data: { networkId: n.id, ...c } });
    return n;
  });
  await audit("network.created", { userId: user.userId, target: n.id, data: { ...body, routerId, collectors } });
  return ok(n);
}, { admin: true });
