import { cidrHosts, isRandomizedMac } from "@netmon/network-core";
import type { Observation } from "@netmon/shared-validation";
import type { Config } from "./config.js";
import { arpScan, neighbourTable, type ArpEntry } from "./discovery/arp.js";
import { pingMany } from "./discovery/icmp.js";
import { nmapSweep } from "./discovery/nmap.js";
import { resolveHostname } from "./discovery/hostname.js";
import { vendorFor } from "./discovery/oui.js";
import { known, record } from "./health.js";
import { log } from "./log.js";

export interface ScanHooks { onStart?: (total: number) => Promise<void>; onProgress?: (scanned: number, found: number) => void; onError?: (msg: string) => Promise<void> }

export async function scanCidr(cfg: Config, cidr: string, signal: AbortSignal, hooks: ScanHooks = {}): Promise<Observation[]> {
  const hosts = cidrHosts(cidr);
  await hooks.onStart?.(hosts.length);
  const arp = new Map<string, string>();
  const methods = new Map<string, Set<"ARP" | "ICMP" | "NMAP">>();
  const add = (ip: string, m: "ARP" | "ICMP" | "NMAP") => { (methods.get(ip) ?? methods.set(ip, new Set()).get(ip)!).add(m); };
  const hostnames = new Map<string, string>();

  if (cfg.ENABLE_ARP) {
    try { for (const e of await arpScan(cidr, cfg.SCAN_INTERFACE)) { arp.set(e.ip, e.mac); add(e.ip, "ARP"); } }
    catch (e) { log("warn", "active ARP unavailable, falling back to neighbour table", { cidr, error: String(e) }); }
  }
  if (signal.aborted) return [];

  let icmp = new Map<string, { alive: boolean; latencyMs?: number }>();
  if (cfg.ENABLE_ICMP) {
    icmp = await pingMany(hosts, cfg.PING_TIMEOUT, cfg.SCAN_CONCURRENCY, (done) => hooks.onProgress?.(done, [...methods.keys()].length));
    for (const [ip, r] of icmp) if (r.alive) add(ip, "ICMP");
  }
  if (cfg.ENABLE_ARP) {
    const nt: ArpEntry[] = await neighbourTable(cidr).catch(() => []);
    for (const e of nt) { if (!arp.has(e.ip)) { arp.set(e.ip, e.mac); add(e.ip, "ARP"); } }
  }
  if (cfg.ENABLE_NMAP) {
    try { for (const h of await nmapSweep(cidr)) { add(h.ip, "NMAP"); if (h.hostname) hostnames.set(h.ip, h.hostname); } }
    catch (e) { await hooks.onError?.(`nmap: ${String(e)}`); }
  }
  if (signal.aborted) return [];

  const now = new Date().toISOString();
  const seen = new Set(methods.keys());
  const out: Observation[] = [];
  for (const ip of seen) {
    const mac = arp.get(ip);
    const r = record(ip, { arp: !!mac, icmp: !!icmp.get(ip)?.alive, mac });
    out.push({
      ip, mac, vendor: mac ? vendorFor(mac) : undefined,
      hostname: hostnames.get(ip) ?? (await resolveHostname(ip)),
      methods: [...methods.get(ip)!], reachable: r.reachable, latencyMs: icmp.get(ip)?.latencyMs,
      macRandomized: mac ? isRandomizedMac(mac) : false, consecutiveFailures: r.failures, icmpBlocked: r.icmpBlocked, observedAt: now,
    });
  }
  // Previously-known hosts in this CIDR that did not answer: report a failed check.
  for (const [ip, s] of known()) {
    if (seen.has(ip) || !hosts.includes(ip)) continue;
    const r = record(ip, { arp: false, icmp: false });
    out.push({ ip, mac: s.mac, methods: [cfg.ENABLE_ICMP ? "ICMP" : "ARP"], reachable: false, macRandomized: s.mac ? isRandomizedMac(s.mac) : false, consecutiveFailures: r.failures, icmpBlocked: !s.everIcmp, observedAt: now });
  }
  hooks.onProgress?.(hosts.length, seen.size);
  return out;
}
