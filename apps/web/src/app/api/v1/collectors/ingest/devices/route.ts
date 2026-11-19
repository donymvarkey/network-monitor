import { ingestDevicesSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok } from "@/lib/api";
import { requireCollector } from "@/lib/collector-auth";
import { ingestObservations } from "@/services/ingest";

export const POST = handler(async (req) => {
  const c = await requireCollector(req);
  const body = ingestDevicesSchema.parse(await req.json());
  try {
    return ok(await ingestObservations(c.id, body.cidr, body.scanJobId, body.observations));
  } catch (e) {
    throw new ApiError(400, "INGEST_REJECTED", e instanceof Error ? e.message : "Ingest failed");
  }
}, { public: true });
