import { routerUpdateSchema } from "@netmon/shared-validation";
import { encryptJson } from "@netmon/router-adapters";
import { ApiError, handler, ok, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { routerDto } from "@/lib/router-dto";

export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  const r = await prisma.router.findUnique({ where: { id }, include: { capabilities: { orderBy: { capability: "asc" } }, network: true, networks: { include: { network: true } } } });
  if (!r) throw new ApiError(404, "NOT_FOUND", "Router not found");
  const collector = r.assignedCollectorId ? await prisma.collector.findUnique({ where: { id: r.assignedCollectorId }, select: { id: true, name: true, status: true } }) : null;
  return ok({ ...routerDto(r), network: r.network, networks: r.networks.map((n) => ({ ...n.network, role: n.role })), collector });
});

export const PATCH = handler(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const { credentials, ...body } = routerUpdateSchema.parse(await req.json());
  const r = await prisma.router.update({
    where: { id },
    data: { ...body, ...(credentials !== undefined && { credentialsEnc: credentials ? encryptJson(credentials) : null }), ...(body.integrationMethod && { integrationStatus: "NOT_CONFIGURED" }) },
  }).catch(() => { throw new ApiError(404, "NOT_FOUND", "Router not found"); });
  if (body.networkId) await prisma.routerNetwork.upsert({ where: { routerId_networkId: { routerId: id, networkId: body.networkId } }, update: {}, create: { routerId: id, networkId: body.networkId } });
  await audit("router.updated", { userId: user.userId, target: id, data: { ...body, credentials: credentials === undefined ? undefined : credentials ? "[changed]" : "[cleared]" } });
  return ok(routerDto(r));
}, { admin: true });

export const DELETE = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  await prisma.router.delete({ where: { id } });
  await audit("router.deleted", { userId: user.userId, target: id });
  return ok(null);
}, { admin: true });
