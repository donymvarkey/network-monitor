import { ingestEventsSchema } from "@netmon/shared-validation";
import type { Prisma } from "@prisma/client";
import { handler, ok } from "@/lib/api";
import { requireCollector } from "@/lib/collector-auth";
import { prisma } from "@/lib/prisma";
import { publishEvent } from "@/lib/redis";

export const POST = handler(async (req) => {
  const c = await requireCollector(req);
  const { events } = ingestEventsSchema.parse(await req.json());
  for (const e of events) {
    if (e.type === "scan.error" && !e.scanJobId) {
      await prisma.networkEvent.create({ data: { type: "collector.error", severity: "WARNING", message: e.error, data: { collectorId: c.id } } });
      continue;
    }
    const id = e.scanJobId!;
    const job = await prisma.scanJob.findFirst({ where: { id, collectorId: c.id } });
    if (!job || job.status === "CANCELLED" || job.status === "FAILED" && e.type !== "scan.error") continue; // ignore updates for cancelled/closed scans
    let data: Prisma.ScanJobUpdateInput = {};
    if (e.type === "scan.started") data = { status: "RUNNING", startedAt: new Date(), hostsTotal: e.hostsTotal };
    if (e.type === "scan.progress") data = { hostsScanned: e.hostsScanned, devicesFound: e.devicesFound, progress: job.hostsTotal ? Math.min(99, Math.round((e.hostsScanned / job.hostsTotal) * 100)) : 0 };
    if (e.type === "scan.completed") data = { status: "COMPLETED", progress: 100, devicesFound: e.devicesFound, finishedAt: new Date() };
    if (e.type === "scan.failed") data = { status: "FAILED", finishedAt: new Date(), errors: [...(job.errors as string[]), e.error] };
    if (e.type === "scan.error") data = { errors: [...(job.errors as string[]), e.error] };
    const updated = await prisma.scanJob.update({ where: { id }, data });
    if (e.type === "scan.completed" || e.type === "scan.failed") {
      await prisma.collector.update({ where: { id: c.id }, data: { lastScanAt: new Date(), lastScanStatus: updated.status } });
      await prisma.networkEvent.create({ data: { networkId: job.networkId, type: e.type, severity: e.type === "scan.failed" ? "WARNING" : "INFO", message: e.type === "scan.failed" ? `Scan failed: ${e.error}` : `Scan completed: ${e.devicesFound} devices` } });
    }
    const evt = e.type === "scan.completed" ? "scan:completed" : e.type === "scan.failed" ? "scan:failed" : "scan:progress";
    await publishEvent(evt, updated);
  }
  return ok({ accepted: events.length });
}, { public: true });
