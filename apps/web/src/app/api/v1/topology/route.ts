import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok } from "@/lib/api";
import { getTopology } from "@/services/topology";

const q = z.object({ networkId: z.string().uuid().optional(), category: z.string().max(20).optional(), showOffline: z.enum(["true", "false"]).default("true") });
export const dynamic = "force-dynamic";
export const GET = handler(async (req: NextRequest) => {
  const p = q.parse(Object.fromEntries(req.nextUrl.searchParams));
  return ok(await getTopology({ networkId: p.networkId, category: p.category, showOffline: p.showOffline === "true" }));
});
