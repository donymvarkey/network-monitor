import { Redis as IORedis } from "ioredis";
import { Queue, Worker, type Job, type Processor } from "bullmq";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  QUEUES, QUEUE_DISCOVERY, QUEUE_STALE, QUEUE_ROUTER_POLL, QUEUE_MONITOR, QUEUE_MONITOR_RESULTS, QUEUE_AGGREGATE, QUEUE_TRAFFIC,
  REDIS_EVENTS_CHANNEL, nextDeviceStatus, computeHealthScore, QUEUE_ALERTS, QUEUE_NOTIFY, QUEUE_MAINTENANCE, redact,
} from "@netmon/network-core";
import { hostname } from "node:os";
import { evaluateDueRules } from "./alerts.js";
import { deliver, fanOut } from "./notify.js";
import { pollRouter } from "@netmon/router-adapters";

const url = process.env.REDIS_URL;
if (!url) throw new Error("REDIS_URL is required");
const connection = new IORedis(url, { maxRetriesPerRequest: null });
const pub = new IORedis(url);
const prisma = new PrismaClient();
// Every log line goes through redact(): tokens, passwords and bearer headers never reach stdout.
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), svc: "worker", msg, ...(redact(extra) as Record<string, unknown>) }));
const emit = (event: string, payload: unknown) => pub.publish(REDIS_EVENTS_CHANNEL, JSON.stringify({ event, payload, emittedAt: new Date().toISOString() }));
const num = (k: string, d: number) => Number(process.env[k] ?? d);

// ---- configurable intervals (env) ----
const COLLECTOR_TIMEOUT_MS = num("COLLECTOR_TIMEOUT_MS", 90_000);
const MONITOR_TICK_MS = num("MONITOR_TICK_MS", 15_000);
const AGGREGATE_EVERY_MS = num("AGGREGATE_EVERY_MS", 300_000);
const PING_TIMEOUT_MS = num("MONITOR_PING_TIMEOUT_MS", 1000);
const RAW_RETENTION_DAYS = num("RAW_METRIC_RETENTION_DAYS", 7);
const ROLLUP_RETENTION_DAYS = num("ROLLUP_RETENTION_DAYS", 90);
const MAX_TARGETS = 1024;
const TRAFFIC_EVERY_MS = num("TRAFFIC_AGGREGATE_EVERY_MS", 300_000);
const TRAFFIC_RAW_RETENTION_DAYS = num("TRAFFIC_RAW_RETENTION_DAYS", 7);
const TRAFFIC_ROLLUP_RETENTION_DAYS = num("TRAFFIC_ROLLUP_RETENTION_DAYS", 90);
const TRAFFIC_STALE_MS = num("TRAFFIC_STALE_MS", 15 * 60_000);

const workers: Worker[] = [];
const queues = new Map<string, Queue>();
const queue = (n: string) => { let q = queues.get(n); if (!q) { q = new Queue(n, { connection }); queues.set(n, q); } return q; };

/** Every processor gets a hard timeout; every failed attempt is recorded in JobFailure. */
function define(name: string, fn: Processor, opts: { concurrency?: number; timeoutMs?: number } = {}): void {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const w = new Worker(name, (job: Job) => Promise.race([
    fn(job),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Job timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]), { connection, concurrency: opts.concurrency ?? 1 });
  w.on("failed", (job, err) => {
    const final = !!job && job.attemptsMade >= (job.opts.attempts ?? 1);
    log("job failed", { queue: name, job: job?.name, id: job?.id, attempt: job?.attemptsMade, final, error: err.message });
    void prisma.jobFailure.create({ data: { queue: name, jobName: job?.name ?? "unknown", jobId: job?.id ?? null, attemptsMade: job?.attemptsMade ?? 0, final, error: err.message.slice(0, 2000), data: (redact(job?.data ?? null) ?? null) as Prisma.InputJsonValue } }).catch(() => undefined);
  });
  w.on("error", (err) => log("worker error", { queue: name, error: err.message }));
  workers.push(w);
}

// ---------------- Phase 2/3 processors (unchanged behaviour) ----------------
define(QUEUE_DISCOVERY, async (job) => {
  const { scanJobId } = job.data as { scanJobId: string };
  // Only QUEUED -> DISPATCHED: a scan the collector already started (or that was cancelled) is never regressed.
  await prisma.scanJob.updateMany({ where: { id: scanJobId, status: "QUEUED" }, data: { status: "DISPATCHED" } });
  const s = await prisma.scanJob.findUnique({ where: { id: scanJobId } });
  if (!s) return;
  log("scan dispatched", { scanJobId });
  await emit("scan:progress", s);
});

define(QUEUE_STALE, async () => {
  const cutoff = new Date(Date.now() - COLLECTOR_TIMEOUT_MS);
  const stale = await prisma.collector.findMany({ where: { status: "CONNECTED", lastSeenAt: { lt: cutoff } } });
  for (const c of stale) {
    await prisma.collector.update({ where: { id: c.id }, data: { status: "DISCONNECTED" } });
    await prisma.networkEvent.create({ data: { networkId: c.networkId, type: "collector.disconnected", severity: "WARNING", message: `Collector ${c.name} stopped sending heartbeats`, data: { collectorId: c.id } } });
    await emit("collector:disconnected", { collectorId: c.id });
    await emit("network:event", { category: "collector" });
  }
  const stuck = await prisma.scanJob.updateMany({ where: { status: { in: ["DISPATCHED", "RUNNING"] }, updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } }, data: { status: "FAILED", finishedAt: new Date(), errors: ["Scan timed out without collector updates"] } });
  if (stale.length || stuck.count) log("staleness sweep", { collectors: stale.length, scans: stuck.count });
});

define(QUEUE_ROUTER_POLL, async (job) => {
  if (job.name === "tick") {
    const routers = await prisma.router.findMany({ where: { integrationMethod: { not: "NONE" }, managementIp: { not: null } }, select: { id: true, pollIntervalSec: true, lastPolledAt: true } });
    for (const r of routers) {
      if (r.lastPolledAt && Date.now() - r.lastPolledAt.getTime() < r.pollIntervalSec * 1000) continue;
      await queue(QUEUE_ROUTER_POLL).add("poll", { routerId: r.id }, { jobId: `poll-${r.id}-${Math.floor(Date.now() / (r.pollIntervalSec * 1000))}`, attempts: 2, backoff: { type: "fixed", delay: 5000 }, removeOnComplete: true, removeOnFail: 50 });
    }
    return;
  }
  const { routerId } = job.data as { routerId: string };
  const res = await pollRouter(prisma, routerId, { persist: true });
  await emit("router:metrics_updated", { routerId, reachable: res.reachable, status: res.status });
  if (res.trafficSamples) await emit("traffic:updated", { routerId });
  if (res.transition) {
    await emit("router:status_changed", { routerId, ...res.transition });
    if (res.transition.to === "OFFLINE") await emit("router:unavailable", { routerId });
    if (res.transition.to === "ONLINE" && res.transition.from === "OFFLINE") await emit("router:recovered", { routerId });
    await emit("network:event", { category: "router" });
  }
}, { concurrency: 4, timeoutMs: 45_000 });

// ---------------- Phase 4: monitoring engine ----------------

/**
 * Tick: creates at most one MonitorTask per network per interval bucket. The unique dedupeKey
 * makes this idempotent across overlapping ticks, multiple worker replicas and restarts.
 * Expired tasks (collector never returned results) are closed and recorded as failures.
 */
define(QUEUE_MONITOR, async () => {
  const now = new Date();
  const expired = await prisma.monitorTask.findMany({ where: { status: { in: ["PENDING", "DISPATCHED"] }, expiresAt: { lt: now } }, select: { id: true, networkId: true, collectorId: true, status: true } });
  for (const t of expired) {
    await prisma.monitorTask.update({ where: { id: t.id }, data: { status: "EXPIRED", error: t.status === "PENDING" ? "Collector did not pick up the task" : "Collector did not return results" } });
    await prisma.jobFailure.create({ data: { queue: QUEUE_MONITOR, jobName: "monitor-task", jobId: t.id, final: true, error: `Monitoring round expired (${t.status.toLowerCase()})`, data: { networkId: t.networkId, collectorId: t.collectorId } } });
  }

  const networks = await prisma.network.findMany({
    select: { id: true, monitorIntervalSec: true, pingCount: true, lastMonitoredAt: true, collectorLinks: { where: { isPrimary: true, collector: { status: "CONNECTED" } }, select: { collectorId: true } } },
  });
  let created = 0;
  for (const n of networks) {
    const primary = n.collectorLinks[0]?.collectorId;
    if (!primary) continue; // no connected primary collector: dashboard reports this honestly
    if (n.lastMonitoredAt && now.getTime() - n.lastMonitoredAt.getTime() < n.monitorIntervalSec * 1000 * 0.9) continue; // respect the interval
    const open = await prisma.monitorTask.count({ where: { networkId: n.id, status: { in: ["PENDING", "DISPATCHED"] } } });
    if (open) continue;
    const bucket = Math.floor(now.getTime() / (n.monitorIntervalSec * 1000));
    const targets = await prisma.$queryRaw<{ ip: string }[]>`
      SELECT DISTINCT host(a.address) AS ip FROM "DeviceAddress" a JOIN "Device" d ON d.id = a."deviceId"
      WHERE a."networkId" = ${n.id}::uuid AND a."validTo" IS NULL AND d."mergedIntoId" IS NULL AND a.family = 'IPV4'
      LIMIT ${MAX_TARGETS}`;
    if (!targets.length) continue;
    try {
      await prisma.monitorTask.create({ data: {
        networkId: n.id, collectorId: primary, dedupeKey: `${n.id}:${n.monitorIntervalSec}:${bucket}`,
        targets: targets.map((t) => t.ip), pingCount: n.pingCount, timeoutMs: PING_TIMEOUT_MS,
        expiresAt: new Date(now.getTime() + Math.max(2 * n.monitorIntervalSec * 1000, 120_000)),
      } });
      created++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // already created for this bucket
      throw e;
    }
  }
  if (created || expired.length) log("monitor tick", { created, expired: expired.length });
}, { timeoutMs: 30_000 });

/** Evaluates one completed round: consecutive-failure status machine, transitions, events, realtime. */
define(QUEUE_MONITOR_RESULTS, async (job) => {
  const { monitorTaskId } = job.data as { monitorTaskId: string };
  const task = await prisma.monitorTask.findUnique({ where: { id: monitorTaskId }, include: { network: true, measurements: true } });
  if (!task) return;
  const threshold = task.network.offlineThreshold;
  const devices = await prisma.device.findMany({ where: { id: { in: [...new Set(task.measurements.map((m) => m.deviceId))] } } });
  const byId = new Map(devices.map((d) => [d.id, d]));
  const out: [string, unknown][] = [];
  for (const m of task.measurements) {
    const d = byId.get(m.deviceId);
    if (!d) continue;
    const reachable = m.received > 0;
    // ICMP-blocking devices (flagged in discovery) are not marked offline by ICMP loss alone.
    if (!reachable && d.icmpBlocked) continue;
    const failures = reachable ? 0 : d.consecutiveFailures + 1;
    const status = nextDeviceStatus(d.status, reachable, failures, threshold);
    await prisma.$transaction(async (tx) => {
      await tx.device.update({ where: { id: d.id }, data: { status, consecutiveFailures: failures, lastCollectorId: task.collectorId, ...(reachable && { lastSeenAt: m.measuredAt, lastSuccessfulAt: m.measuredAt }) } });
      if (status !== d.status) {
        await tx.deviceStatusTransition.create({ data: { deviceId: d.id, fromStatus: d.status, toStatus: status, reason: reachable ? "monitor: reachable" : `monitor: ${failures} consecutive failed probes`, occurredAt: m.measuredAt } });
        await tx.networkEvent.create({ data: { networkId: task.networkId, deviceId: d.id, type: `device.${status.toLowerCase()}`, severity: status === "OFFLINE" ? "WARNING" : "INFO", message: `Device ${d.displayName ?? d.hostname ?? m.targetIp} is ${status.toLowerCase()}`, data: { collectorId: task.collectorId, ip: m.targetIp, packetLoss: m.packetLoss } } });
      }
    });
    if (status !== d.status) out.push([status === "ONLINE" ? "device:online" : "device:offline", { deviceId: d.id, from: d.status, to: status }]);
  }
  for (const [e, p] of out) await emit(e, p);
  if (out.length) await emit("network:event", { category: "device" });
  await emit("latency:updated", { networkId: task.networkId, monitorTaskId });
}, { concurrency: 2, timeoutMs: 60_000 });

/** Hourly rollups, health snapshots and retention. Charts only ever read aggregated rows. */
define(QUEUE_AGGREGATE, async () => {
  await prisma.$executeRaw`
    INSERT INTO "LatencyRollup" (id, "deviceId", "networkId", "bucketStart", samples, "upSamples", "avgMs", "minMs", "maxMs", "packetLoss")
    SELECT gen_random_uuid(), "deviceId", "networkId", date_trunc('hour', "measuredAt"), count(*)::int, (count(*) FILTER (WHERE received > 0))::int,
           avg("avgMs"), min("minMs"), max("maxMs"), avg("packetLoss")
    FROM "LatencyMeasurement" WHERE "measuredAt" >= date_trunc('hour', now()) - interval '2 hours'
    GROUP BY "deviceId", "networkId", date_trunc('hour', "measuredAt")
    ON CONFLICT ("deviceId", "bucketStart") DO UPDATE SET samples = EXCLUDED.samples, "upSamples" = EXCLUDED."upSamples",
      "avgMs" = EXCLUDED."avgMs", "minMs" = EXCLUDED."minMs", "maxMs" = EXCLUDED."maxMs", "packetLoss" = EXCLUDED."packetLoss"`;

  const since = new Date(Date.now() - 15 * 60_000);
  const networks = await prisma.network.findMany({ select: { id: true } });
  const snap = async (networkId: string | null) => {
    const dw = { mergedIntoId: null, ...(networkId && { networkId }) };
    const [statuses, routers, collectors, lat] = await Promise.all([
      prisma.device.groupBy({ by: ["status"], where: dw, _count: true }),
      prisma.router.groupBy({ by: ["status"], where: networkId ? { networkId } : {}, _count: true }),
      networkId ? prisma.collectorNetwork.findMany({ where: { networkId }, select: { collector: { select: { status: true } } } }).then((r) => r.map((x) => x.collector))
                : prisma.collector.findMany({ select: { status: true } }),
      prisma.latencyMeasurement.aggregate({ where: { measuredAt: { gte: since }, ...(networkId && { networkId }) }, _avg: { avgMs: true, packetLoss: true }, _count: true }),
    ]);
    const c = (s: string) => statuses.find((x) => x.status === s)?._count ?? 0;
    const online = c("ONLINE"), offline = c("OFFLINE"), unknown = c("UNKNOWN");
    const routersTotal = routers.reduce((a, r) => a + r._count, 0), routersUp = routers.find((r) => r.status === "ONLINE")?._count ?? 0;
    const collectorsTotal = collectors.length, collectorsUp = collectors.filter((x) => x.status === "CONNECTED").length;
    const packetLoss = lat._count ? lat._avg.packetLoss : null;
    await prisma.networkHealthSnapshot.create({ data: {
      networkId, devicesTotal: online + offline + unknown, online, offline, unknown, routersTotal, routersUp, collectorsTotal, collectorsUp,
      avgLatencyMs: lat._count ? lat._avg.avgMs : null, packetLoss,
      healthScore: computeHealthScore({ online, offline, routersUp, routersTotal, collectorsUp, collectorsTotal, packetLoss }),
    } });
  };
  await snap(null);
  for (const n of networks) await snap(n.id);

  const day = 86_400_000;
  await prisma.latencyMeasurement.deleteMany({ where: { measuredAt: { lt: new Date(Date.now() - RAW_RETENTION_DAYS * day) } } });
  await prisma.latencyRollup.deleteMany({ where: { bucketStart: { lt: new Date(Date.now() - ROLLUP_RETENTION_DAYS * day) } } });
  await prisma.networkHealthSnapshot.deleteMany({ where: { takenAt: { lt: new Date(Date.now() - ROLLUP_RETENTION_DAYS * day) } } });
  await prisma.monitorTask.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 2 * day) }, status: { in: ["COMPLETED", "EXPIRED"] } } });
  await prisma.jobFailure.deleteMany({ where: { failedAt: { lt: new Date(Date.now() - num("JOB_FAILURE_RETENTION_DAYS", 30) * day) } } });
  await emit("network:health_updated", {});
}, { timeoutMs: 120_000 });

// ---------------- Phase 5: traffic rollups, staleness and retention ----------------
define(QUEUE_TRAFFIC, async () => {
  // Re-aggregating the last 3 hours makes this idempotent and tolerant of late uploads.
  await prisma.$executeRaw`
    INSERT INTO "TrafficRollup" (id, key, scope, "sourceId", "deviceId", "interfaceId", "routerId", "networkId", "countsTowardTotal", "bucketStart", "downloadBytes", "uploadBytes", "maxDownloadBps", "maxUploadBps", samples)
    SELECT gen_random_uuid(), scope::text || ':' || COALESCE("deviceId", "interfaceId")::text || ':' || "sourceId"::text, scope, "sourceId", "deviceId", "interfaceId",
           max("routerId"::text)::uuid, max("networkId"::text)::uuid, bool_or("countsTowardTotal"), date_trunc('hour', "measuredAt"),
           sum("downloadBytes")::bigint, sum("uploadBytes")::bigint, max("downloadBps"), max("uploadBps"), count(*)::int
    FROM "TrafficSample" WHERE "measuredAt" >= date_trunc('hour', now()) - interval '3 hours'
    GROUP BY scope, "sourceId", "deviceId", "interfaceId", date_trunc('hour', "measuredAt")
    ON CONFLICT (key, "bucketStart") DO UPDATE SET "downloadBytes" = EXCLUDED."downloadBytes", "uploadBytes" = EXCLUDED."uploadBytes",
      "maxDownloadBps" = EXCLUDED."maxDownloadBps", "maxUploadBps" = EXCLUDED."maxUploadBps", samples = EXCLUDED.samples,
      "routerId" = EXCLUDED."routerId", "networkId" = EXCLUDED."networkId", "countsTowardTotal" = EXCLUDED."countsTowardTotal"`;
  const stale = await prisma.trafficSource.updateMany({ where: { status: "ACTIVE", OR: [{ lastSampleAt: { lt: new Date(Date.now() - TRAFFIC_STALE_MS) } }, { lastSampleAt: null, createdAt: { lt: new Date(Date.now() - TRAFFIC_STALE_MS) } }] }, data: { status: "STALE", detail: "No samples received recently" } });
  const day = 86_400_000;
  await prisma.trafficSample.deleteMany({ where: { measuredAt: { lt: new Date(Date.now() - TRAFFIC_RAW_RETENTION_DAYS * day) } } });
  await prisma.trafficRollup.deleteMany({ where: { bucketStart: { lt: new Date(Date.now() - TRAFFIC_ROLLUP_RETENTION_DAYS * day) } } });
  // Raw cumulative counters are only needed for the next delta.
  await prisma.interfaceMetric.deleteMany({ where: { timestamp: { lt: new Date(Date.now() - num("INTERFACE_METRIC_RETENTION_DAYS", 2) * day) } } });
  if (stale.count) log("traffic sources marked stale", { count: stale.count });
  await emit("traffic:updated", {});
}, { timeoutMs: 120_000 });

// Remaining Phase 1 placeholder queues (alerts, periodic scans) stay registered until their phase.
for (const name of [QUEUES.scans, QUEUES.alerts, QUEUES.monitoring]) define(name, async (job) => log("job received, no processor yet", { queue: name, id: job.id }));

// Job schedulers are upserts: restarting the worker never duplicates them.

// ---------------- Phase 6: alerting, notifications, maintenance, liveness ----------------
const VERSION = process.env.APP_VERSION ?? "0.6.0";
const STARTED_AT = new Date();
const ALERT_TICK_MS = num("ALERT_TICK_MS", 30_000);

define(QUEUE_ALERTS, async () => {
  const changes = await evaluateDueRules(prisma);
  const pending = await fanOut(prisma, changes);
  for (const id of pending) {
    // Delivery is a separate queue: slow/failed SMTP never blocks monitoring or rule evaluation.
    await queue(QUEUE_NOTIFY).add("deliver", { notificationId: id }, { jobId: `notify-${id}`, attempts: num("NOTIFY_ATTEMPTS", 5), backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true, removeOnFail: 200 });
  }
  for (const c of changes) await emit(c.kind === "triggered" ? "alert:created" : "alert:resolved", { alertId: c.alertId, severity: c.severity });
  if (changes.length) { await emit("notification:new", { count: changes.length }); await emit("network:event", { category: "alert" }); log("alerts evaluated", { changes: changes.length, notifications: pending.length }); }
}, { timeoutMs: 60_000 });

define(QUEUE_NOTIFY, async (job) => {
  const { notificationId } = job.data as { notificationId: string };
  await deliver(prisma, notificationId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
}, { concurrency: 2, timeoutMs: 45_000 });

/** Retention for tables that grow without bound. 0 (default for most) = keep forever. Inventory is never touched. */
async function applyRetention(): Promise<Record<string, number>> {
  const day = 86_400_000;
  const cut = (k: string, d: number) => { const n = num(k, d); return n > 0 ? new Date(Date.now() - n * day) : null; };
  const out: Record<string, number> = {};
  const run = async (name: string, k: string, d: number, fn: (c: Date) => Promise<{ count: number }>) => { const c = cut(k, d); if (c) out[name] = (await fn(c)).count; };
  await run("deviceObservations", "OBSERVATION_RETENTION_DAYS", 0, (c) => prisma.deviceObservation.deleteMany({ where: { observedAt: { lt: c } } }));
  await run("deviceMetrics", "DEVICE_METRIC_RETENTION_DAYS", 0, (c) => prisma.deviceMetric.deleteMany({ where: { timestamp: { lt: c } } }));
  await run("routerMetrics", "ROUTER_METRIC_RETENTION_DAYS", 0, (c) => prisma.routerMetric.deleteMany({ where: { timestamp: { lt: c } } }));
  await run("trafficFlows", "TRAFFIC_FLOW_RETENTION_DAYS", 0, (c) => prisma.trafficFlow.deleteMany({ where: { startedAt: { lt: c } } }));
  await run("networkEvents", "EVENT_RETENTION_DAYS", 0, (c) => prisma.networkEvent.deleteMany({ where: { occurredAt: { lt: c } } }));
  await run("resolvedAlerts", "RESOLVED_ALERT_RETENTION_DAYS", 0, (c) => prisma.alert.deleteMany({ where: { state: "RESOLVED", resolvedAt: { lt: c } } }));
  await run("notifications", "NOTIFICATION_RETENTION_DAYS", 0, (c) => prisma.notification.deleteMany({ where: { createdAt: { lt: c } } }));
  await run("auditLogs", "AUDIT_LOG_RETENTION_DAYS", 0, (c) => prisma.auditLog.deleteMany({ where: { createdAt: { lt: c } } }));
  return out;
}

define(QUEUE_MAINTENANCE, async (job) => {
  if (job.name === "heartbeat") {
    const counts = await Promise.all(QUEUES_ALL.map(async (n) => [n, await queue(n).getJobCounts("active", "waiting", "delayed", "failed")] as const));
    await prisma.serviceHeartbeat.upsert({ where: { service: "worker" }, update: { lastBeatAt: new Date(), version: VERSION, hostname: hostname(), startedAt: STARTED_AT, info: { queues: Object.fromEntries(counts) } }, create: { service: "worker", version: VERSION, hostname: hostname(), startedAt: STARTED_AT, lastBeatAt: new Date(), info: { queues: Object.fromEntries(counts) } } });
    return;
  }
  const removed = await applyRetention();
  if (Object.values(removed).some((n) => n > 0)) log("retention applied", removed);
}, { timeoutMs: 10 * 60_000 });

const QUEUES_ALL = [QUEUE_DISCOVERY, QUEUE_STALE, QUEUE_ROUTER_POLL, QUEUE_MONITOR, QUEUE_MONITOR_RESULTS, QUEUE_AGGREGATE, QUEUE_TRAFFIC, QUEUE_ALERTS, QUEUE_NOTIFY, QUEUE_MAINTENANCE];

/** Startup recovery: work interrupted by a crash/restart is closed honestly instead of hanging. */
async function recoverOnBoot(): Promise<void> {
  const grace = new Date(Date.now() - num("SCAN_RECOVERY_GRACE_MS", 10 * 60_000));
  const scans = await prisma.scanJob.updateMany({ where: { status: "QUEUED", createdAt: { lt: grace } }, data: { status: "FAILED", finishedAt: new Date(), errors: ["Scan was queued before a worker restart and never dispatched"] } });
  // QUEUED scans newer than the grace window are re-dispatched (jobId dedupes against BullMQ).
  const requeue = await prisma.scanJob.findMany({ where: { status: "QUEUED" }, select: { id: true } });
  for (const s of requeue) await queue(QUEUE_DISCOVERY).add("dispatch", { scanJobId: s.id }, { jobId: s.id, removeOnComplete: true, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
  // Notifications left PENDING (worker died mid-delivery) are re-enqueued; jobId keeps this idempotent.
  const pend = await prisma.notification.findMany({ where: { status: "PENDING" }, select: { id: true }, take: 500 });
  for (const n of pend) await queue(QUEUE_NOTIFY).add("deliver", { notificationId: n.id }, { jobId: `notify-${n.id}`, attempts: num("NOTIFY_ATTEMPTS", 5), backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true, removeOnFail: 200 });
  log("boot recovery", { failedScans: scans.count, requeuedScans: requeue.length, requeuedNotifications: pend.length });
}
await recoverOnBoot();

await queue(QUEUE_STALE).upsertJobScheduler("sweep", { every: 30_000 }, { name: "sweep" });
await queue(QUEUE_ROUTER_POLL).upsertJobScheduler("router-tick", { every: 15_000 }, { name: "tick" });
await queue(QUEUE_MONITOR).upsertJobScheduler("monitor-tick", { every: MONITOR_TICK_MS }, { name: "tick" });
await queue(QUEUE_AGGREGATE).upsertJobScheduler("aggregate", { every: AGGREGATE_EVERY_MS }, { name: "aggregate" });
await queue(QUEUE_TRAFFIC).upsertJobScheduler("traffic", { every: TRAFFIC_EVERY_MS }, { name: "traffic" });
// Schedulers are keyed: restarts and extra replicas update the same schedule instead of adding duplicates.
await queue(QUEUE_ALERTS).upsertJobScheduler("alerts", { every: ALERT_TICK_MS }, { name: "evaluate" });
await queue(QUEUE_MAINTENANCE).upsertJobScheduler("heartbeat", { every: 30_000 }, { name: "heartbeat" });
await queue(QUEUE_MAINTENANCE).upsertJobScheduler("retention", { every: num("RETENTION_EVERY_MS", 6 * 3_600_000) }, { name: "retention" });
// Run one aggregation right away so a fresh install gets its first snapshot without waiting.
await queue(QUEUE_AGGREGATE).add("aggregate", {}, { jobId: `aggregate-boot-${Math.floor(Date.now() / 60_000)}`, removeOnComplete: true, removeOnFail: 20 });
log("worker started", { monitorTickMs: MONITOR_TICK_MS, aggregateEveryMs: AGGREGATE_EVERY_MS });

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return; // SIGINT + SIGTERM together must not close connections twice
  stopping = true;
  log("shutting down");
  // Mark ourselves stopped so the health page does not wait for the heartbeat to go stale.
  await prisma.serviceHeartbeat.update({ where: { service: "worker" }, data: { info: { stopped: true } } }).catch(() => undefined);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  await prisma.$disconnect(); await connection.quit(); await pub.quit();
  process.exit(0);
}
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
