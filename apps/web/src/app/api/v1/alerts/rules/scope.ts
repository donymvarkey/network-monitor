import "server-only";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Referenced network/device/router must exist and belong together (no cross-network scoping). */
export async function assertRuleScope(r: { networkId?: string | null; deviceId?: string | null; routerId?: string | null }): Promise<void> {
  if (r.networkId && !(await prisma.network.findUnique({ where: { id: r.networkId }, select: { id: true } }))) throw new ApiError(400, "BAD_SCOPE", "Network not found");
  if (r.deviceId) {
    const d = await prisma.device.findUnique({ where: { id: r.deviceId }, select: { networkId: true } });
    if (!d) throw new ApiError(400, "BAD_SCOPE", "Device not found");
    if (r.networkId && d.networkId !== r.networkId) throw new ApiError(400, "BAD_SCOPE", "Device is not in the selected network");
  }
  if (r.routerId) {
    const x = await prisma.router.findUnique({ where: { id: r.routerId }, select: { networkId: true } });
    if (!x) throw new ApiError(400, "BAD_SCOPE", "Router not found");
    if (r.networkId && x.networkId !== r.networkId) throw new ApiError(400, "BAD_SCOPE", "Router is not in the selected network");
  }
}
