import { handler, ok } from "@/lib/api";
import { getDashboard } from "@/services/dashboard";

export const dynamic = "force-dynamic";
export const GET = handler(async () => ok(await getDashboard()));
