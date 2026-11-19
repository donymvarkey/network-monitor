import { mergeDeviceSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { publishEvent } from "@/lib/redis";

/** Manual merge: moves identifiers/addresses/observations from source into target. */
export const POST = handler(async (req, { params }) => {
  const { id: targetId } = await params;
  const user = await requireUser();
  const { sourceDeviceId } = mergeDeviceSchema.parse(await req.json());
  if (sourceDeviceId === targetId) throw new ApiError(400, "INVALID", "Cannot merge a device into itself");
  await prisma.$transaction(async (tx) => {
    await tx.deviceIdentifier.updateMany({ where: { deviceId: sourceDeviceId }, data: { deviceId: targetId } });
    await tx.deviceAddress.updateMany({ where: { deviceId: sourceDeviceId }, data: { deviceId: targetId } });
    await tx.deviceObservation.updateMany({ where: { deviceId: sourceDeviceId }, data: { deviceId: targetId } });
    await tx.device.update({ where: { id: sourceDeviceId }, data: { mergedIntoId: targetId } });
  });
  await audit("device.merged", { userId: user.userId, target: targetId, data: { sourceDeviceId } });
  await publishEvent("device:updated", { deviceId: targetId });
  return ok({ targetId, sourceDeviceId });
}, { admin: true });
