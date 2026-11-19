import { z } from "zod";
import { chartRangeSchema } from "@netmon/shared-validation";
import { handler, ok } from "@/lib/api";
import { getCharts } from "@/services/dashboard";

export const dynamic = "force-dynamic";
export const GET = handler(async (req) => {
  const sp = req.nextUrl.searchParams;
  const range = chartRangeSchema.parse(sp.get("range") ?? undefined);
  const networkId = z.string().uuid().nullable().parse(sp.get("networkId"));
  return ok(await getCharts(range, networkId));
});
