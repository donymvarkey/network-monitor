import { routerCreateSchema } from "@netmon/shared-validation";
import { encryptJson } from "@netmon/router-adapters";
import { handler, ok, parsePagination, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { routerDto } from "@/lib/router-dto";

export const GET = handler(async (req) => {
  const { page, pageSize } = parsePagination(req);
  const [rows, total, collectors] = await Promise.all([
    prisma.router.findMany({ skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "asc" }, include: { capabilities: true, network: { select: { id: true, name: true, cidr: true, context: true } } } }),
    prisma.router.count(),
    prisma.collector.findMany({ select: { id: true, name: true } }),
  ]);
  const cn = new Map(collectors.map((c) => [c.id, c.name]));
  return ok(rows.map((r) => ({ ...routerDto(r), network: r.network, collectorName: r.assignedCollectorId ? cn.get(r.assignedCollectorId) ?? null : null })), { page, pageSize, total });
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const { credentials, ...body } = routerCreateSchema.parse(await req.json());
  const r = await prisma.router.create({
    data: { ...body, credentialsEnc: credentials ? encryptJson(credentials) : null, networks: { create: { networkId: body.networkId, role: "LAN" } } },
  });
  await audit("router.created", { userId: user.userId, target: r.id, data: { ...body, credentials: credentials ? "[set]" : null } });
  return ok(routerDto(r));
}, { admin: true });
