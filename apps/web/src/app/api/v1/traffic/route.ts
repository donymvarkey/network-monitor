import type { NextRequest } from "next/server";
import { z } from "zod";
import { trafficRangeSchema } from "@netmon/shared-validation";
import { handler, ok } from "@/lib/api";
import { getTraffic } from "@/services/traffic";

export const dynamic = "force-dynamic";
export const GET = handler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const range = trafficRangeSchema.parse(sp.get("range") ?? undefined);
  const networkId = z.string().uuid().optional().parse(sp.get("networkId") || undefined);
  return ok(await getTraffic(range, networkId));
});
