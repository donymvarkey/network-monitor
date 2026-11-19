import type { NextRequest } from "next/server";
import { trafficRangeSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getDeviceTraffic } from "@/services/traffic";

export const dynamic = "force-dynamic";
export const GET = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  if (!(await prisma.device.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "NOT_FOUND", "Device not found");
  return ok(await getDeviceTraffic(id, trafficRangeSchema.parse(req.nextUrl.searchParams.get("range") ?? undefined)));
});
