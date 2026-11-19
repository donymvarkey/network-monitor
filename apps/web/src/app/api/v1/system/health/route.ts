import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { redis, getQueue } from "@/lib/redis";
import { QUEUE_DISCOVERY, QUEUE_STALE, QUEUE_ROUTER_POLL, QUEUE_MONITOR, QUEUE_MONITOR_RESULTS, QUEUE_AGGREGATE, QUEUE_TRAFFIC, QUEUE_ALERTS, QUEUE_NOTIFY, QUEUE_MAINTENANCE } from "@netmon/network-core";

export const dynamic = "force-dynamic";
type Check = { status: "up" | "down" | "stale" | "unknown"; detail?: string; hint?: string; [k: string]: unknown };
const QUEUES = [QUEUE_DISCOVERY, QUEUE_STALE, QUEUE_ROUTER_POLL, QUEUE_MONITOR, QUEUE_MONITOR_RESULTS, QUEUE_AGGREGATE, QUEUE_TRAFFIC, QUEUE_ALERTS, QUEUE_NOTIFY, QUEUE_MAINTENANCE];
const timed = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error(`timed out after ${ms} ms`)), ms))]);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Every value here is measured at request time or read from a service heartbeat. Nothing is estimated. */
export const GET = handler(async () => {
  const now = Date.now();
  const out: Record<string, Check> = { web: { status: "up", version: process.env.APP_VERSION ?? "0.6.0", uptimeSec: Math.round(process.uptime()), node: process.version } };

  try {
    const t = Date.now();
    const [size] = await timed(prisma.$queryRaw<{ bytes: bigint; version: string }[]>`SELECT pg_database_size(current_database()) AS bytes, version() AS version`, 3000);
    const tables = await prisma.$queryRaw<{ name: string; bytes: bigint; rows: bigint }[]>`SELECT relname AS name, pg_total_relation_size(relid) AS bytes, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`;
    out.postgres = { status: "up", latencyMs: Date.now() - t, sizeBytes: Number(size?.bytes ?? 0), version: size?.version.split(" ").slice(0, 2).join(" "), largestTables: tables.map((x) => ({ name: x.name, bytes: Number(x.bytes), rows: Number(x.rows) })) };
  } catch (e) { out.postgres = { status: "down", detail: msg(e), hint: "Check the postgres container: ./scripts/netmon.sh logs postgres. Verify DATABASE_URL." }; }

  let redisUp = false;
  try {
    const t = Date.now();
    await timed(redis.ping(), 2000);
    const info = await redis.info("memory");
    redisUp = true;
    out.redis = { status: "up", latencyMs: Date.now() - t, usedMemory: /used_memory_human:(\S+)/.exec(info)?.[1] ?? null };
  } catch (e) { out.redis = { status: "down", detail: msg(e), hint: "Check the redis container and REDIS_URL. Monitoring jobs and live updates pause while Redis is down." }; }

  const beats = out.postgres.status === "up" ? await prisma.serviceHeartbeat.findMany() : [];
  const worker = beats.find((b) => b.service === "worker");
  if (!worker) out.worker = { status: "unknown", detail: "The worker has never reported in", hint: "Start the worker: ./scripts/netmon.sh logs worker" };
  else {
    const age = Math.round((now - worker.lastBeatAt.getTime()) / 1000);
    const stopped = (worker.info as { stopped?: boolean } | null)?.stopped === true;
    out.worker = { status: stopped ? "down" : age > 90 ? "stale" : "up", lastBeatSecAgo: age, version: worker.version, hostname: worker.hostname, startedAt: worker.startedAt, ...(age > 90 && { hint: "No worker heartbeat for over 90 s. Check ./scripts/netmon.sh logs worker" }) };
  }

  const rtUrl = process.env.REALTIME_INTERNAL_URL ?? "http://localhost:4001";
  try {
    const t = Date.now();
    const r = await timed(fetch(`${rtUrl}/health`, { cache: "no-store" }), 2000);
    const body = (await r.json().catch(() => ({}))) as { clients?: number };
    out.realtime = r.ok ? { status: "up", latencyMs: Date.now() - t, clients: body.clients ?? null } : { status: "down", detail: `HTTP ${r.status}` };
  } catch (e) { out.realtime = { status: "down", detail: msg(e), hint: `Realtime gateway not reachable at ${rtUrl}. Live updates fall back to periodic refresh.` }; }

  let jobs: { queue: string; active: number; waiting: number; delayed: number; failed: number }[] | null = null;
  if (redisUp) {
    try { jobs = await timed(Promise.all(QUEUES.map(async (q) => { const c = await getQueue(q).getJobCounts("active", "waiting", "delayed", "failed"); return { queue: q, active: c.active ?? 0, waiting: c.waiting ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 }; })), 3000); } catch { jobs = null; }
  }

  const db = out.postgres.status === "up";
  const [collectors, failures, backup, backupBeat] = db ? await Promise.all([
    prisma.collector.findMany({ select: { id: true, name: true, status: true, lastSeenAt: true, version: true, revokedAt: true } }),
    prisma.jobFailure.findMany({ where: { failedAt: { gte: new Date(now - 86_400_000) } }, orderBy: { failedAt: "desc" }, take: 10, select: { id: true, queue: true, jobName: true, error: true, final: true, failedAt: true } }),
    prisma.backupRecord.findFirst({ where: { status: "SUCCESS" }, orderBy: { startedAt: "desc" } }),
    Promise.resolve(beats.find((b) => b.service === "backup") ?? null),
  ]) : [[], [], null, null];
  const lastBackupAttempt = db ? await prisma.backupRecord.findFirst({ orderBy: { startedAt: "desc" } }) : null;

  return ok({
    checkedAt: new Date(now).toISOString(),
    services: out,
    collectors: collectors.map((c) => ({ ...c, lastSeenSecAgo: c.lastSeenAt ? Math.round((now - c.lastSeenAt.getTime()) / 1000) : null })),
    jobs,
    recentFailures: failures,
    backup: {
      lastSuccess: backup ? { ...backup, sizeBytes: backup.sizeBytes === null ? null : Number(backup.sizeBytes) } : null,
      lastAttempt: lastBackupAttempt ? { status: lastBackupAttempt.status, startedAt: lastBackupAttempt.startedAt, error: lastBackupAttempt.error } : null,
      schedulerSeen: backupBeat ? backupBeat.lastBeatAt : null,
    },
  });
});
