import "server-only";
import { deviceKind } from "@netmon/network-core";
import { prisma } from "@/lib/prisma";

/**
 * Topology read model built from stored records only. Every edge carries its evidence:
 *  VERIFIED   – directly reported by a device/router/collector (e.g. router client table, router WAN status)
 *  CONFIGURED – a relationship an administrator configured (router↔network links, collector assignments)
 *  INFERRED   – derived from addressing (e.g. a router's WAN IP lies inside another network). Not a confirmed cable.
 *  UNKNOWN    – related, but the evidence is stale or missing.
 * Logical memberships (device seen on a subnet) are marked connectionType LOGICAL — never as a physical link.
 */
export type Evidence = "VERIFIED" | "CONFIGURED" | "INFERRED" | "UNKNOWN";
export type NodeKind = "internet" | "router" | "network" | "collector" | "computer" | "phone" | "iot" | "switch" | "unknown";
export interface TopoNode { id: string; kind: NodeKind; label: string; sublabel?: string | null; status?: string | null; entityId?: string; networkId?: string | null; category?: string | null; tier: number; detail?: Record<string, string | null> }
export interface TopoEdge { id: string; source: string; target: string; connectionType: "WAN" | "UPLINK" | "WIRED" | "WIRELESS" | "LOGICAL" | "MANAGEMENT" | "UNKNOWN"; evidence: Evidence; discoverySource: string; confidence: number; lastVerifiedAt: string | null }

const DAY = 86_400_000;
const toN = (ip: string) => ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
function inCidr(ip: string | null, cidr: string): boolean {
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [b, bits] = cidr.split("/"); const m = Number(bits) === 0 ? 0 : (~((1 << (32 - Number(bits))) - 1)) >>> 0;
  return ((toN(ip) & m) >>> 0) === ((toN(b!) & m) >>> 0);
}
const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export async function getTopology(opts: { networkId?: string; category?: string; showOffline: boolean }) {
  const [networks, routers, collectors, devices, leases, positions] = await Promise.all([
    prisma.network.findMany({ select: { id: true, name: true, cidr: true, context: true, gateway: true } }),
    prisma.router.findMany({ include: { networks: true } }),
    prisma.collector.findMany({ include: { networks: true } }),
    prisma.device.findMany({
      where: { mergedIntoId: null, ...(opts.networkId && { networkId: opts.networkId }), ...(!opts.showOffline && { status: { not: "OFFLINE" } }) },
      select: { id: true, displayName: true, hostname: true, vendor: true, category: true, deviceType: true, status: true, networkId: true, lastSeenAt: true, lastCollectorId: true, addresses: { where: { validTo: null }, select: { address: true }, take: 1 }, identifiers: { where: { type: "MAC" }, select: { value: true }, take: 1 } },
      take: 2000,
    }),
    prisma.dHCPLease.findMany({ where: { routerId: { not: null }, OR: [{ lastReportedAt: { gte: new Date(Date.now() - DAY) } }, { lastReportedAt: null, updatedAt: { gte: new Date(Date.now() - DAY) } }] }, select: { routerId: true, macAddress: true, connectionType: true, lastReportedAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }),
    prisma.topologyNodePosition.findMany(),
  ]);

  const nodes: TopoNode[] = [], edges: TopoEdge[] = [];
  const add = (e: Omit<TopoEdge, "id">) => { const id = `${e.source}->${e.target}`; if (!edges.some((x) => x.id === id)) edges.push({ id, ...e }); };
  const routerDeviceIds = new Set(routers.map((r) => r.deviceId).filter(Boolean) as string[]);
  const visibleNetworks = opts.networkId ? networks.filter((n) => n.id === opts.networkId) : networks;
  const routerInScope = (r: (typeof routers)[number]) => !opts.networkId || r.networkId === opts.networkId || r.networks.some((l) => l.networkId === opts.networkId);

  for (const n of visibleNetworks) nodes.push({ id: `network:${n.id}`, kind: "network", label: n.name, sublabel: n.cidr, entityId: n.id, networkId: n.id, tier: 2, detail: { context: n.context, gateway: n.gateway } });

  // ---- routers, uplinks, Internet ----
  const scopedRouters = routers.filter(routerInScope);
  let internet = false;
  for (const r of scopedRouters) {
    const upstreamCfg = r.networks.find((l) => l.role === "UPSTREAM" || l.role === "WAN");
    const upstreamByIp = !upstreamCfg && r.wanIp ? networks.find((n) => n.id !== r.networkId && inCidr(r.wanIp, n.cidr)) : undefined;
    const isSecondary = !!(upstreamCfg || upstreamByIp);
    nodes.push({ id: `router:${r.id}`, kind: "router", label: r.name, sublabel: [r.manufacturer, r.model].filter(Boolean).join(" ") || r.managementIp, status: r.status, entityId: r.id, networkId: r.networkId, tier: isSecondary ? 3 : 1,
      detail: { managementIp: r.managementIp, wanIp: r.wanIp, lanIp: r.lanIp, integration: r.integrationMethod, integrationStatus: r.integrationStatus } });

    // Router -> the LAN(s) it serves
    add({ source: `router:${r.id}`, target: `network:${r.networkId}`, connectionType: "WIRED", evidence: "CONFIGURED", discoverySource: "router configuration (primary network)", confidence: 90, lastVerifiedAt: iso(r.lastSeenAt) });
    for (const l of r.networks.filter((l) => l.role === "LAN" && l.networkId !== r.networkId))
      add({ source: `router:${r.id}`, target: `network:${l.networkId}`, connectionType: "WIRED", evidence: "CONFIGURED", discoverySource: "router↔network link (LAN)", confidence: 90, lastVerifiedAt: iso(r.lastSeenAt) });

    // Router uplink
    if (upstreamCfg) add({ source: `network:${upstreamCfg.networkId}`, target: `router:${r.id}`, connectionType: "UPLINK", evidence: "CONFIGURED", discoverySource: `router↔network link (${upstreamCfg.role})`, confidence: 85, lastVerifiedAt: iso(r.lastSeenAt) });
    else if (upstreamByIp) add({ source: `network:${upstreamByIp.id}`, target: `router:${r.id}`, connectionType: "UPLINK", evidence: "INFERRED", discoverySource: `WAN IP ${r.wanIp} is inside ${upstreamByIp.cidr}`, confidence: 60, lastVerifiedAt: iso(r.lastPolledAt) });
    else if (r.wanIp || r.wanUp !== null) {
      internet = true;
      const reported = r.wanUp === true && !!r.lastPolledAt && Date.now() - r.lastPolledAt.getTime() < DAY;
      add({ source: "internet", target: `router:${r.id}`, connectionType: "WAN",
        evidence: reported ? "VERIFIED" : r.wanIp && !isPrivate(r.wanIp) ? "INFERRED" : "UNKNOWN",
        discoverySource: reported ? `router reports WAN up (${r.integrationMethod})` : r.wanIp ? `router WAN IP ${r.wanIp}` : "router WAN state reported down/unknown",
        confidence: reported ? 90 : r.wanIp && !isPrivate(r.wanIp) ? 50 : 20, lastVerifiedAt: iso(r.lastPolledAt) });
    }
  }
  // Segments served by a secondary router sit below that router.
  for (const r of scopedRouters) {
    if (nodes.find((n) => n.id === `router:${r.id}`)?.tier !== 3) continue;
    for (const nid of [r.networkId, ...r.networks.filter((l) => l.role === "LAN").map((l) => l.networkId)]) {
      const nn = nodes.find((n) => n.id === `network:${nid}`);
      if (nn && !edges.some((e) => e.target === `router:${r.id}` && e.source === nn.id)) nn.tier = 4;
    }
  }
  if (internet) nodes.unshift({ id: "internet", kind: "internet", label: "Internet / WAN", sublabel: "reported by router", tier: 0 });

  // ---- collectors ----
  for (const c of collectors) {
    const links = c.networks.length ? c.networks : c.networkId ? [{ networkId: c.networkId, isPrimary: true }] : [];
    const scoped = links.filter((l) => visibleNetworks.some((n) => n.id === l.networkId));
    if (!scoped.length) continue;
    nodes.push({ id: `collector:${c.id}`, kind: "collector", label: c.name, sublabel: c.hostname, status: c.status, entityId: c.id, networkId: scoped[0]!.networkId, tier: 3, detail: { version: c.version } });
    for (const l of scoped) add({ source: `network:${l.networkId}`, target: `collector:${c.id}`, connectionType: "LOGICAL", evidence: "CONFIGURED", discoverySource: l.isPrimary ? "collector assignment (primary)" : "collector assignment", confidence: 90, lastVerifiedAt: iso(c.lastSeenAt) });
  }

  // ---- devices ----
  const leaseByMac = new Map<string, (typeof leases)[number]>();
  for (const l of leases) if (!leaseByMac.has(l.macAddress.toLowerCase())) leaseByMac.set(l.macAddress.toLowerCase(), l);
  const routerIds = new Set(scopedRouters.map((r) => r.id));
  for (const d of devices) {
    if (routerDeviceIds.has(d.id)) continue; // shown as its router node
    const kind = deviceKind(d.category, d.deviceType);
    if (opts.category && opts.category !== "all" && kind !== opts.category) continue;
    const mac = d.identifiers[0]?.value?.toLowerCase();
    nodes.push({ id: `device:${d.id}`, kind: kind === "router" ? "switch" : kind, label: d.displayName ?? d.hostname ?? d.addresses[0]?.address ?? "Unnamed device", sublabel: d.addresses[0]?.address ?? null, status: d.status, entityId: d.id, networkId: d.networkId, category: d.category, tier: 5, detail: { vendor: d.vendor, mac: mac ?? null } });
    const lease = mac ? leaseByMac.get(mac) : undefined;
    if (lease?.routerId && routerIds.has(lease.routerId)) {
      // The router's own client table lists this MAC: a verified association with that router.
      add({ source: `router:${lease.routerId}`, target: `device:${d.id}`, connectionType: (lease.connectionType as TopoEdge["connectionType"]) ?? "UNKNOWN", evidence: "VERIFIED", discoverySource: lease.connectionType ? `router client table (${lease.connectionType.toLowerCase()})` : "router client table", confidence: 90, lastVerifiedAt: iso(lease.lastReportedAt ?? lease.updatedAt) });
    } else {
      const fresh = d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < DAY;
      add({ source: `network:${d.networkId}`, target: `device:${d.id}`, connectionType: "LOGICAL", evidence: fresh ? "VERIFIED" : "UNKNOWN", discoverySource: fresh ? "seen on this subnet by a collector (ARP/ICMP) — subnet membership, not a physical link" : "not seen in the last 24 h", confidence: fresh ? 80 : 30, lastVerifiedAt: iso(d.lastSeenAt) });
    }
  }

  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    positions: Object.fromEntries(positions.filter((p) => ids.has(p.nodeId)).map((p) => [p.nodeId, { x: p.x, y: p.y }])),
    networks: networks.map((n) => ({ id: n.id, name: n.name, cidr: n.cidr })),
    generatedAt: new Date().toISOString(),
    truncated: devices.length >= 2000,
  };
}
export type Topology = Awaited<ReturnType<typeof getTopology>>;
