import { chartRangeSchema } from "@netmon/shared-validation";
import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
/**
 * Latency / packet loss / availability from collector measurements only (never browser timing).
 * Charts use hourly rollups (daily for 30d) so the payload stays small; the latest raw rounds are listed separately.
 */
export const GET = handler(async (req, { params }) => {
  const { id } = await params;
  const range = chartRangeSchema.parse(req.nextUrl.searchParams.get("range") ?? undefined);
  const hours = range === "24h" ? 24 : range === "7d" ? 168 : 720;
  const unit = range === "30d" ? "day" : "hour";
  const since = new Date(Date.now() - hours * 3600_000);
  const [series, totals, recent] = await Promise.all([
    prisma.$queryRaw<{ t: Date; avg: number | null; min: number | null; max: number | null; loss: number | null; avail: number | null }[]>`
      SELECT date_trunc(${unit}, "bucketStart") AS t,
             (sum("avgMs" * "upSamples") / NULLIF(sum("upSamples") FILTER (WHERE "avgMs" IS NOT NULL), 0))::float AS avg,
             min("minMs")::float AS min, max("maxMs")::float AS max,
             (sum("packetLoss" * samples) / NULLIF(sum(samples), 0))::float AS loss,
             (sum("upSamples")::float / NULLIF(sum(samples), 0))::float AS avail
      FROM "LatencyRollup" WHERE "deviceId" = ${id}::uuid AND "bucketStart" >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.latencyRollup.aggregate({ where: { deviceId: id, bucketStart: { gte: since } }, _sum: { samples: true, upSamples: true } }),
    prisma.latencyMeasurement.findMany({ where: { deviceId: id }, orderBy: { measuredAt: "desc" }, take: 20, select: { id: true, measuredAt: true, minMs: true, avgMs: true, maxMs: true, packetLoss: true, sent: true, received: true, targetIp: true, collector: { select: { name: true } } } }),
  ]);
  const samples = totals._sum.samples ?? 0;
  return ok({
    range,
    availability: samples ? (totals._sum.upSamples ?? 0) / samples : null,
    samples,
    series: series.map((s) => ({ t: s.t.toISOString(), avg: s.avg, min: s.min, max: s.max, loss: s.loss, availability: s.avail })),
    recent,
  });
});
