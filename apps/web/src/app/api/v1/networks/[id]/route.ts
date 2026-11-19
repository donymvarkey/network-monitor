import { networkUpsertSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

const patch = networkUpsertSchema.partial();

export const PATCH = handler(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const { routerId, collectors, ...body } = patch.parse(await req.json());
  if (collectors && collectors.filter((c) => c.isPrimary).length > 1) throw new ApiError(400, "INVALID", "Only one primary collector per network");
  await prisma.$transaction(async (tx) => {
    if (Object.keys(body).length) await tx.network.update({ where: { id }, data: body });
    if (routerId !== undefined) {
      await tx.routerNetwork.deleteMany({ where: { networkId: id, role: "LAN" } });
      if (routerId) await tx.routerNetwork.create({ data: { routerId, networkId: id, role: "LAN" } });
    }
    if (collectors) {
      await tx.collectorNetwork.deleteMany({ where: { networkId: id } });
      for (const c of collectors) await tx.collectorNetwork.create({ data: { networkId: id, ...c } });
    }
  }).catch((e) => { if (String(e).includes("Unique")) throw new ApiError(409, "DUPLICATE", "CIDR already exists in that context"); throw e; });
  await audit("network.updated", { userId: user.userId, target: id, data: { ...body, routerId, collectors } });
  return ok({ id });
}, { admin: true });
