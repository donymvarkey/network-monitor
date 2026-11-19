import { Prisma, type PrismaClient, type AlertRule, type AlertSeverity } from "@prisma/client";
import { alertFingerprint, alertTransition, downLongEnough, ruleDue, thresholdBreached, ONE_SHOT_TYPES } from "@netmon/network-core";

/** One evaluated target. `breached` null = no data (alert neither opens nor resolves). */
export interface Finding {
  target: string; breached: boolean | null; title: string; value?: number | null;
  deviceId?: string | null; networkId?: string | null; routerId?: string | null; collectorId?: string | null;
  details?: Record<string, unknown>;
}
export interface AlertChange { alertId: string; kind: "triggered" | "resolved"; severity: AlertSeverity; title: string; notifyEmail: boolean }

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

/** Collects findings for a rule from real stored monitoring data only. */
export async function evaluateRule(prisma: PrismaClient, rule: AlertRule, now: Date): Promise<Finding[]> {
  if (!rule.type) return [];
  const netFilter = rule.networkId ? { networkId: rule.networkId } : {};
  const since = minutesAgo(now, rule.windowMin);
  switch (rule.type) {
    case "DEVICE_OFFLINE": {
      const devices = await prisma.device.findMany({ where: { ...netFilter, ...(rule.deviceId && { id: rule.deviceId }), mergedIntoId: null, status: { in: ["ONLINE", "OFFLINE"] } }, select: { id: true, networkId: true, status: true, displayName: true, hostname: true, lastSuccessfulAt: true, lastSeenAt: true } });
      return devices.map((d) => ({ target: `device:${d.id}`, deviceId: d.id, networkId: d.networkId,
        breached: d.status === "OFFLINE" && downLongEnough(d.lastSuccessfulAt ?? d.lastSeenAt ?? now, now, rule.threshold ?? 0),
        title: `Device ${d.displayName ?? d.hostname ?? d.id.slice(0, 8)} is offline` }));
    }
    case "DEVICE_ONLINE": {
      // Event-style: each OFFLINE→ONLINE transition since the last evaluation fires once.
      const from = rule.lastEvaluatedAt ?? minutesAgo(now, rule.windowMin);
      const tr = await prisma.deviceStatusTransition.findMany({ where: { fromStatus: "OFFLINE", toStatus: "ONLINE", occurredAt: { gt: from, lte: now }, device: { ...netFilter, ...(rule.deviceId && { id: rule.deviceId }) } }, include: { device: { select: { id: true, networkId: true, displayName: true, hostname: true } } } });
      return tr.map((t) => ({ target: `device:${t.deviceId}:${t.id}`, deviceId: t.deviceId, networkId: t.device.networkId, breached: true, title: `Device ${t.device.displayName ?? t.device.hostname ?? t.deviceId.slice(0, 8)} is back online`, details: { at: t.occurredAt } }));
    }
    case "ROUTER_OFFLINE": {
      const routers = await prisma.router.findMany({ where: { ...netFilter, ...(rule.routerId && { id: rule.routerId }), status: { in: ["ONLINE", "OFFLINE"] } }, select: { id: true, name: true, networkId: true, status: true, lastSeenAt: true } });
      return routers.map((r) => ({ target: `router:${r.id}`, routerId: r.id, networkId: r.networkId, breached: r.status === "OFFLINE" && downLongEnough(r.lastSeenAt ?? now, now, rule.threshold ?? 0), title: `Router ${r.name} is unreachable` }));
    }
    case "COLLECTOR_DISCONNECTED": {
      const cs = await prisma.collector.findMany({ where: { revokedAt: null, status: { in: ["CONNECTED", "DISCONNECTED"] }, ...(rule.networkId && { networks: { some: { networkId: rule.networkId } } }) }, select: { id: true, name: true, status: true, lastSeenAt: true, networkId: true } });
      return cs.map((c) => ({ target: `collector:${c.id}`, collectorId: c.id, networkId: rule.networkId ?? c.networkId, breached: c.status === "DISCONNECTED" && downLongEnough(c.lastSeenAt ?? now, now, rule.threshold ?? 0), title: `Collector ${c.name} disconnected` }));
    }
    case "HIGH_LATENCY":
    case "HIGH_PACKET_LOSS": {
      const rows = await prisma.latencyMeasurement.groupBy({ by: ["deviceId", "networkId"], where: { ...netFilter, ...(rule.deviceId && { deviceId: rule.deviceId }), measuredAt: { gte: since } }, _avg: { avgMs: true, packetLoss: true }, _count: true });
      const names = new Map((await prisma.device.findMany({ where: { id: { in: rows.map((r) => r.deviceId) } }, select: { id: true, displayName: true, hostname: true, icmpBlocked: true } })).map((d) => [d.id, d]));
      return rows.flatMap((r) => {
        const d = names.get(r.deviceId);
        if (rule.type === "HIGH_PACKET_LOSS" && d?.icmpBlocked) return []; // ICMP-blocking devices would always show 100 % loss
        const value = rule.type === "HIGH_LATENCY" ? r._avg.avgMs : r._avg.packetLoss;
        const label = d?.displayName ?? d?.hostname ?? r.deviceId.slice(0, 8);
        return [{ target: `device:${r.deviceId}`, deviceId: r.deviceId, networkId: r.networkId, value, breached: thresholdBreached(value, rule.threshold),
          title: rule.type === "HIGH_LATENCY" ? `High latency on ${label}: ${value?.toFixed(1)} ms` : `Packet loss on ${label}: ${((value ?? 0) * 100).toFixed(0)} %`,
          details: { samples: r._count, windowMin: rule.windowMin, threshold: rule.threshold } }];
      });
    }
    case "HIGH_BANDWIDTH": {
      // Only per-device measured samples (router client stats / NetFlow). Aggregate router traffic is never split.
      const rows = await prisma.trafficSample.groupBy({ by: ["deviceId"], where: { scope: "DEVICE", ...netFilter, ...(rule.deviceId && { deviceId: rule.deviceId }), deviceId: rule.deviceId ?? { not: null }, measuredAt: { gte: since } }, _avg: { downloadBps: true, uploadBps: true }, _count: true });
      return rows.filter((r) => r.deviceId).map((r) => {
        const value = (r._avg.downloadBps ?? 0) + (r._avg.uploadBps ?? 0);
        return { target: `device:${r.deviceId}`, deviceId: r.deviceId, networkId: rule.networkId, value, breached: thresholdBreached(r._count ? value : null, rule.threshold),
          title: `High bandwidth: ${(value / 1e6).toFixed(1)} Mbit/s`, details: { samples: r._count, windowMin: rule.windowMin } };
      });
    }
    case "NETWORK_UNAVAILABLE": {
      const nets = await prisma.network.findMany({ where: rule.networkId ? { id: rule.networkId } : {}, select: { id: true, name: true, devices: { where: { mergedIntoId: null, status: { in: ["ONLINE", "OFFLINE"] } }, select: { status: true } }, collectorLinks: { select: { collector: { select: { status: true } } } } } });
      return nets.map((n) => {
        const online = n.devices.filter((d) => d.status === "ONLINE").length;
        const collectorUp = n.collectorLinks.some((l) => l.collector.status === "CONNECTED");
        const breached = n.devices.length === 0 && n.collectorLinks.length === 0 ? null : (!collectorUp && n.collectorLinks.length > 0) || (n.devices.length > 0 && online === 0);
        return { target: `network:${n.id}`, networkId: n.id, breached, title: `Network ${n.name} is unavailable`, details: { devices: n.devices.length, online, collectorUp } };
      });
    }
    case "MONITORING_FAILURE": {
      const failures = await prisma.jobFailure.count({ where: { final: true, failedAt: { gte: since } } });
      const beats = await prisma.serviceHeartbeat.findMany();
      const stale = beats.filter((b) => b.service !== "backup" && now.getTime() - b.lastBeatAt.getTime() > 3 * 60_000).map((b) => b.service);
      return [{ target: "system", breached: failures > (rule.threshold ?? 0) || stale.length > 0, value: failures,
        title: stale.length ? `Monitoring service not responding: ${stale.join(", ")}` : `${failures} background job(s) failed in ${rule.windowMin} min`, details: { failures, stale } }];
    }
  }
}

/** Applies findings: opens/touches/resolves alerts in transactions so concurrent ticks cannot duplicate. */
export async function applyFindings(prisma: PrismaClient, rule: AlertRule, findings: Finding[], now: Date): Promise<AlertChange[]> {
  const changes: AlertChange[] = [];
  const oneShot = !!rule.type && ONE_SHOT_TYPES.includes(rule.type);
  const seen = new Set<string>();
  for (const f of findings) {
    const fp = alertFingerprint(rule.id, f.target);
    seen.add(fp);
    await prisma.$transaction(async (tx) => {
      // Row lock on the rule serialises evaluation of the same rule across worker replicas.
      await tx.$queryRaw`SELECT id FROM "AlertRule" WHERE id = ${rule.id}::uuid FOR UPDATE`;
      const open = await tx.alert.findFirst({ where: { fingerprint: fp, state: { in: ["OPEN", "ACKNOWLEDGED"] } } });
      const action = alertTransition(open ? (open.state as "OPEN" | "ACKNOWLEDGED") : null, f.breached);
      if (action === "open") {
        const a = await tx.alert.create({ data: { ruleId: rule.id, fingerprint: fp, severity: rule.severity, title: f.title, value: f.value ?? null, deviceId: f.deviceId ?? null, networkId: f.networkId ?? null, routerId: f.routerId ?? null, collectorId: f.collectorId ?? null, details: (f.details ?? {}) as Prisma.InputJsonValue, triggeredAt: now, lastSeenAt: now, ...(oneShot && { state: "RESOLVED", resolvedAt: now }) } });
        await tx.networkEvent.create({ data: { networkId: f.networkId ?? null, deviceId: f.deviceId ?? null, type: "alert.triggered", severity: rule.severity, message: f.title, data: { alertId: a.id, ruleId: rule.id } } });
        changes.push({ alertId: a.id, kind: "triggered", severity: rule.severity, title: f.title, notifyEmail: rule.notifyEmail });
      } else if (action === "touch" && open) {
        await tx.alert.update({ where: { id: open.id }, data: { lastSeenAt: now, ...(f.breached !== null && { value: f.value ?? null, title: f.title }) } });
      } else if (action === "resolve" && open) {
        await tx.alert.update({ where: { id: open.id }, data: { state: "RESOLVED", resolvedAt: now, lastSeenAt: now } });
        await tx.networkEvent.create({ data: { networkId: open.networkId, deviceId: open.deviceId, type: "alert.resolved", severity: "INFO", message: `Resolved: ${open.title}`, data: { alertId: open.id, ruleId: rule.id } } });
        changes.push({ alertId: open.id, kind: "resolved", severity: open.severity, title: open.title, notifyEmail: rule.notifyEmail });
      }
    });
  }
  // Targets that disappeared (device deleted, rule scope narrowed) are resolved, not left open forever.
  if (!oneShot) {
    const orphans = await prisma.alert.findMany({ where: { ruleId: rule.id, state: { in: ["OPEN", "ACKNOWLEDGED"] }, fingerprint: { notIn: [...seen] } } });
    for (const o of orphans) {
      await prisma.alert.update({ where: { id: o.id }, data: { state: "RESOLVED", resolvedAt: now, details: { ...(o.details as object ?? {}), resolvedReason: "target no longer in scope" } } });
      changes.push({ alertId: o.id, kind: "resolved", severity: o.severity, title: o.title, notifyEmail: false });
    }
  }
  await prisma.alertRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: now } });
  return changes;
}

export async function evaluateDueRules(prisma: PrismaClient, now = new Date()): Promise<AlertChange[]> {
  // Alerts whose rule disappeared (deleted directly or via a network cascade) cannot be evaluated anymore: close them.
  await prisma.alert.updateMany({ where: { ruleId: null, state: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { state: "RESOLVED", resolvedAt: now } });
  const rules = await prisma.alertRule.findMany({ where: { enabled: true, type: { not: null } } });
  const out: AlertChange[] = [];
  for (const r of rules) {
    if (!ruleDue(r.lastEvaluatedAt, now, r.evalIntervalSec)) continue;
    out.push(...(await applyFindings(prisma, r, await evaluateRule(prisma, r, now), now)));
  }
  return out;
}
