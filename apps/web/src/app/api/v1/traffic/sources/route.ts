import { handler, ok } from "@/lib/api";
import { getTrafficSources } from "@/services/traffic";

export const dynamic = "force-dynamic";
export const GET = handler(async () => ok(await getTrafficSources()));
