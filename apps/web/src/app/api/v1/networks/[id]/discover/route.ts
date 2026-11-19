import { ApiError, handler, ok, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getQueue } from "@/lib/redis";
import { QUEUE_DISCOVERY } from "@netmon/network-core";
import { audit } from "@/lib/audit";

/** Creates a ScanJob and hands it to BullMQ; the collector picks it up on its next heartbeat. */
export const POST = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const link = await prisma.collectorNetwork.findFirst({ where: { networkId: id, collector: { status: "CONNECTED" } }, orderBy: { isPrimary: "desc" } });
  if (!link) throw new ApiError(409, "NO_COLLECTOR", "No connected collector is assigned to this network");
  // Advisory lock per network: two simultaneous clicks cannot both pass the "already running" check.
  const job = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"scan:" + id}))`;
    const running = await tx.scanJob.findFirst({ where: { networkId: id, status: { in: ["QUEUED", "DISPATCHED", "RUNNING"] } } });
    if (running) throw new ApiError(409, "SCAN_IN_PROGRESS", "A scan is already in progress for this network");
    // QUEUED until the worker dispatches it, so a Redis outage never silently drops the request (recovered on worker boot).
    return tx.scanJob.create({ data: { networkId: id, collectorId: link.collectorId, requestedById: user.userId, status: "QUEUED" } });
  });
  try {
    await getQueue(QUEUE_DISCOVERY as never).add("dispatch", { scanJobId: job.id }, { jobId: job.id, removeOnComplete: true, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
  } catch {
    throw new ApiError(503, "QUEUE_UNAVAILABLE", "Scan saved but the job queue is unreachable; it will be dispatched when the worker reconnects");
  }
  await audit("network.scan_requested", { userId: user.userId, target: id, data: { scanJobId: job.id } });
  return ok(job);
}, { admin: true });

/** Cancel any active scan for this network. The collector's late updates for it are ignored. */
export const DELETE = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const r = await prisma.scanJob.updateMany({ where: { networkId: id, status: { in: ["QUEUED", "DISPATCHED", "RUNNING"] } }, data: { status: "CANCELLED", finishedAt: new Date() } });
  if (r.count) await prisma.networkEvent.create({ data: { networkId: id, type: "scan.cancelled", message: "Scan cancelled by administrator" } });
  await audit("network.scan_cancelled", { userId: user.userId, target: id, data: { cancelled: r.count } });
  return ok({ cancelled: r.count });
}, { admin: true });
