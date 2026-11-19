import type { PrismaClient } from "@prisma/client";
import { adapterFor } from "./index";
import { decryptJson } from "./crypto";
import type { PollResult, RouterTarget } from "./types";
import { counterDelta, guessInterfaceRole } from "@netmon/network-core";

/** Shared by the worker (scheduled) and the web "Test connection" route. Persists results; never logs credentials. */
export async function pollRouter(prisma: PrismaClient, routerId: string, opts: { persist: boolean }): Promise<PollResult & { transition?: { from: string; to: string }; trafficSamples?: number }> {
  const r = await prisma.router.findUniqueOrThrow({ where: { id: routerId }, include: { network: true } });
  const adapter = adapterFor(r.integrationMethod);
  if (!adapter || !r.managementIp) {
    return { status: "UNSUPPORTED", reachable: false, error: r.managementIp ? "No integration method" : "Management IP not set", capabilities: {} };
  }
  const target: RouterTarget = { managementIp: r.managementIp, credentials: r.credentialsEnc ? decryptJson(r.credentialsEnc) : null, timeoutMs: 3000 };
  let res: PollResult;
  try { res = await adapter.poll(target); } catch (e) { res = { status: "UNREACHABLE", reachable: false, error: (e as Error).message, capabilities: {} }; }
  if (!opts.persist) return res;

  const now = new Date();
  const failures = res.reachable ? 0 : r.consecutiveFailures + 1;
  const status = res.reachable ? "ONLINE" : failures >= r.network.offlineThreshold ? "OFFLINE" : r.status;
  await prisma.$transaction(async (tx) => {
    await tx.router.update({
      where: { id: r.id },
      data: {
        status, consecutiveFailures: failures, integrationStatus: res.status, integrationError: res.error ?? null, lastPolledAt: now,
        ...(res.reachable && { lastSeenAt: now }),
        ...(res.identity?.model && { model: r.model ?? res.identity.model }),
        ...(res.identity?.firmware && { firmware: res.identity.firmware }),
        ...(res.lanIp && { lanIp: res.lanIp }), ...(res.wanIp && { wanIp: res.wanIp }),
        ...(res.wanUp !== undefined && { wanUp: res.wanUp }), ...(res.uptimeSec !== undefined && { uptimeSec: BigInt(Math.round(res.uptimeSec)) }),
      },
    });
    for (const [capability, v] of Object.entries(res.capabilities)) {
      await tx.routerCapability.upsert({ where: { routerId_capability: { routerId: r.id, capability } }, update: { state: v!.state, detail: v!.detail ?? null, checkedAt: now }, create: { routerId: r.id, capability, state: v!.state, detail: v!.detail ?? null, checkedAt: now } });
    }
    // ---- Phase 5: traffic from interface counters (SNMP). Deltas only; a reset/implausible delta yields no sample, never a zero. ----
    let trafficSamples = 0;
    const ifSource = res.interfaces?.some((i) => i.rxBytes !== undefined)
      ? await tx.trafficSource.upsert({ where: { kind_sourceKey: { kind: "SNMP_IF_COUNTERS", sourceKey: `router:${r.id}` } }, update: { status: "ACTIVE", detail: null, routerId: r.id }, create: { kind: "SNMP_IF_COUNTERS", sourceKey: `router:${r.id}`, name: `${r.name} interface counters`, routerId: r.id, perDevice: false } })
      : null;
    for (const i of res.interfaces ?? []) {
      const speed = i.speedMbps ? Math.round(i.speedMbps) : null;
      const iface = await tx.routerInterface.upsert({ where: { routerId_name: { routerId: r.id, name: i.name } }, update: { ifIndex: i.ifIndex, macAddress: i.macAddress, speedMbps: speed, isUp: i.isUp }, create: { routerId: r.id, name: i.name, ifIndex: i.ifIndex, macAddress: i.macAddress, speedMbps: speed, isUp: i.isUp, role: guessInterfaceRole(i.name) } });
      if (i.rxBytes === undefined) continue;
      const prev = await tx.interfaceMetric.findFirst({ where: { interfaceId: iface.id }, orderBy: { timestamp: "desc" } });
      let rxBps: number | null = null, txBps: number | null = null;
      if (prev?.rxBytes != null && prev.txBytes != null && i.txBytes !== undefined && ifSource) {
        const secs = (now.getTime() - prev.timestamp.getTime()) / 1000;
        const dRx = secs <= 3600 ? counterDelta(prev.rxBytes, i.rxBytes, secs, speed) : null;
        const dTx = secs <= 3600 ? counterDelta(prev.txBytes, i.txBytes, secs, speed) : null;
        if (dRx !== null && dTx !== null) {
          rxBps = Number(dRx) * 8 / secs; txBps = Number(dTx) * 8 / secs;
          // WAN: in = download. LAN: the router sending out of the port = the LAN downloading.
          const wan = iface.role === "WAN";
          const down = wan ? dRx : dTx, up = wan ? dTx : dRx;
          const util = speed ? Math.min(1, Math.max(rxBps, txBps) / (speed * 1e6)) : null;
          await tx.trafficSample.create({ data: { sourceId: ifSource.id, scope: "INTERFACE", interfaceId: iface.id, routerId: r.id, networkId: r.networkId, countsTowardTotal: wan, downloadBytes: down, uploadBytes: up, downloadBps: Number(down) * 8 / secs, uploadBps: Number(up) * 8 / secs, utilization: util, intervalSec: secs, measuredAt: now } });
          trafficSamples++;
        }
      }
      await tx.interfaceMetric.create({ data: { interfaceId: iface.id, rxBytes: i.rxBytes, txBytes: i.txBytes, rxBps, txBps, errors: i.errors, timestamp: now } });
    }
    if (ifSource && trafficSamples) await tx.trafficSource.update({ where: { id: ifSource.id }, data: { lastSampleAt: now } });

    if (res.clients) {
      for (const c of res.clients) {
        if (!c.ip) continue;
        const existing = await tx.dHCPLease.findFirst({ where: { routerId: r.id, macAddress: c.mac, address: c.ip, leaseEnd: null } });
        if (!existing) await tx.dHCPLease.create({ data: { routerId: r.id, macAddress: c.mac, address: c.ip, hostname: c.hostname, connectionType: c.connection ?? null, lastReportedAt: now, leaseStart: now } });
        else await tx.dHCPLease.update({ where: { id: existing.id }, data: { lastReportedAt: now, ...(c.connection && { connectionType: c.connection }) } });
      }
      // Per-device traffic only when the router itself reports per-client byte counters, matched by MAC identifier.
      const counted = res.clients.filter((c) => c.rxBytes !== undefined && c.txBytes !== undefined);
      if (counted.length) {
        const src = await tx.trafficSource.upsert({ where: { kind_sourceKey: { kind: "ROUTER_CLIENT_STATS", sourceKey: `router:${r.id}` } }, update: { status: "ACTIVE", detail: null }, create: { kind: "ROUTER_CLIENT_STATS", sourceKey: `router:${r.id}`, name: `${r.name} client statistics`, routerId: r.id, perDevice: true } });
        const state = (src.state ?? {}) as Record<string, { rx: string; tx: string; at: number }>;
        const next: typeof state = {};
        const ids = await tx.deviceIdentifier.findMany({ where: { type: "MAC", value: { in: counted.map((c) => c.mac.toLowerCase()) } }, select: { value: true, deviceId: true, device: { select: { networkId: true } } } });
        const byMac = new Map(ids.map((x) => [x.value, x]));
        let n = 0;
        for (const c of counted) {
          const mac = c.mac.toLowerCase();
          next[mac] = { rx: String(c.rxBytes), tx: String(c.txBytes), at: now.getTime() };
          const p = state[mac], dev = byMac.get(mac);
          if (!p || !dev) continue; // first reading, or no device with that MAC: nothing attributable yet
          const secs = (now.getTime() - p.at) / 1000;
          if (secs > 3600) continue;
          const down = counterDelta(BigInt(p.rx), c.rxBytes!, secs, null, 64), up = counterDelta(BigInt(p.tx), c.txBytes!, secs, null, 64);
          if (down === null || up === null) continue;
          await tx.trafficSample.create({ data: { sourceId: src.id, scope: "DEVICE", deviceId: dev.deviceId, routerId: r.id, networkId: dev.device.networkId, countsTowardTotal: false, downloadBytes: down, uploadBytes: up, downloadBps: Number(down) * 8 / secs, uploadBps: Number(up) * 8 / secs, intervalSec: secs, measuredAt: now } });
          n++;
        }
        await tx.trafficSource.update({ where: { id: src.id }, data: { state: next, ...(n && { lastSampleAt: now }) } });
        trafficSamples += n;
      }
    }
    (res as { trafficSamples?: number }).trafficSamples = trafficSamples;
    await tx.routerMetric.create({ data: { routerId: r.id, reachable: res.reachable, latencyMs: res.latencyMs, uptimeSec: res.uptimeSec !== undefined ? BigInt(Math.round(res.uptimeSec)) : null, clientCount: res.clients?.length ?? null, timestamp: now } });
    if (status !== r.status) await tx.networkEvent.create({ data: { networkId: r.networkId, type: `router.${status.toLowerCase()}`, severity: status === "OFFLINE" ? "WARNING" : "INFO", message: `Router ${r.name} is ${status.toLowerCase()}`, data: { routerId: r.id } } });
  });
  return { ...res, ...(status !== r.status && { transition: { from: r.status, to: status } }) };
}
