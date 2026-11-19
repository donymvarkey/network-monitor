import { updateDeviceSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { publishEvent } from "@/lib/redis";

export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  const d = await prisma.device.findUnique({
    where: { id },
    include: { network: true, identifiers: true, addresses: { where: { validTo: null } }, mergedFrom: { select: { id: true, displayName: true, hostname: true } } },
  });
  if (!d) throw new ApiError(404, "NOT_FOUND", "Device not found");
  return ok(d);
});

export const PATCH = handler(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const body = updateDeviceSchema.parse(await req.json());
  const d = await prisma.device.update({ where: { id }, data: body }).catch(() => { throw new ApiError(404, "NOT_FOUND", "Device not found"); });
  await audit("device.updated", { userId: user.userId, target: id, data: body });
  await publishEvent("device:updated", { deviceId: id });
  return ok(d);
});
