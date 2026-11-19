import { interfaceRoleSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/** Admin override of an interface's WAN/LAN role. Only WAN interfaces count toward traffic totals. */
export const PATCH = handler(async (req, { params }) => {
  const { id, interfaceId } = await params;
  const { role } = interfaceRoleSchema.parse(await req.json());
  const i = await prisma.routerInterface.findFirst({ where: { id: interfaceId, routerId: id } });
  if (!i) throw new ApiError(404, "NOT_FOUND", "Interface not found");
  const u = await prisma.routerInterface.update({ where: { id: i.id }, data: { role } });
  const s = await requireUser();
  await audit("router.interface.role", { userId: s.userId, target: i.id, data: { from: i.role, to: role } });
  return ok(u);
}, { admin: true });
