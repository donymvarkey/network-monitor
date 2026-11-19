import { hostname as osHostname } from "node:os";
import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { loadOui } from "./discovery/oui.js";
import { scanCidr } from "./scan.js";
import { log } from "./log.js";
import { ipInCidr } from "@netmon/network-core";
import { runMonitorTask, type MonitorTask } from "./monitor.js";
import { startNetflow } from "./traffic/netflow.js";

const VERSION = "0.5.0";
const cfg = loadConfig();
const post = createApi(cfg);
const ctrl = new AbortController();
const started = Date.now();
let activeScanId: string | null = null;
let busy = false;
const monitoring = new Set<string>();
let primaryCidrs = new Set<string>(cfg.NETWORK_CIDRS);

async function runScan(cidr: string, scanJobId: string | null): Promise<void> {
  if (busy) return;
  busy = true; activeScanId = scanJobId;
  const ev = (events: unknown[]) => post("/collectors/ingest/events", { events }).catch((e) => log("error", "event push failed", { error: String(e) }));
  let lastProgress = 0;
  try {
    log("info", "scan started", { cidr, scanJobId });
    const obs = await scanCidr(cfg, cidr, ctrl.signal, {
      onStart: async (total) => { if (scanJobId) await ev([{ type: "scan.started", scanJobId, hostsTotal: total }]); },
      onProgress: (scanned, found) => { if (scanJobId && Date.now() - lastProgress > 2000) { lastProgress = Date.now(); void ev([{ type: "scan.progress", scanJobId, hostsScanned: scanned, devicesFound: found }]); } },
      onError: async (msg) => { await ev([{ type: "scan.error", scanJobId, error: msg }]); },
    });
    for (let i = 0; i < obs.length; i += 500) await post("/collectors/ingest/devices", { cidr, scanJobId, observations: obs.slice(i, i + 500) });
    const found = obs.filter((o) => o.reachable).length;
    if (scanJobId) await ev([{ type: "scan.completed", scanJobId, devicesFound: found }]);
    log("info", "scan completed", { cidr, scanJobId, observations: obs.length, reachable: found });
  } catch (e) {
    log("error", "scan failed", { cidr, scanJobId, error: String(e) });
    if (scanJobId) await ev([{ type: "scan.failed", scanJobId, error: String(e) }]);
    else await ev([{ type: "scan.error", scanJobId: null, error: `${cidr}: ${String(e)}` }]);
  } finally { busy = false; activeScanId = null; }
}

/** Monitoring probes run independently of discovery scans; one in-flight run per task. */
async function runMonitor(t: MonitorTask): Promise<void> {
  if (monitoring.has(t.monitorTaskId)) return;
  monitoring.add(t.monitorTaskId);
  try {
    const started = Date.now();
    // Never probe outside the private CIDRs this collector was explicitly configured with.
    const targets = t.targets.filter((ip) => cfg.NETWORK_CIDRS.some((c) => ipInCidr(ip, c)));
    if (targets.length < t.targets.length) log("warn", "ignored monitor targets outside configured CIDRs", { count: t.targets.length - targets.length });
    const results = await runMonitorTask({ ...t, targets }, cfg.MONITOR_CONCURRENCY, cfg.PROBE_INTERVAL, ctrl.signal);
    // One upload per round (targets are capped at 1024 by the worker) so evaluation happens exactly once.
    await post("/collectors/ingest/latency", { monitorTaskId: t.monitorTaskId, results });
    log("info", "monitor round completed", { task: t.monitorTaskId, targets: results.length, reachable: results.filter((r) => r.received > 0).length, ms: Date.now() - started });
  } catch (e) {
    log("error", "monitor round failed", { task: t.monitorTaskId, error: String(e) });
  } finally { monitoring.delete(t.monitorTaskId); }
}

async function heartbeat(): Promise<void> {
  try {
    const r = await post<{ scans: { scanJobId: string; cidr: string }[]; assignments: { cidr: string; primary: boolean }[]; monitors?: MonitorTask[] }>("/collectors/heartbeat", { version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000), activeScanId }, 1);
    primaryCidrs = new Set(r.assignments.filter((a) => a.primary).map((a) => a.cidr));
    for (const m of r.monitors ?? []) void runMonitor(m);
    for (const s of r.scans) if (cfg.NETWORK_CIDRS.includes(s.cidr)) await runScan(s.cidr, s.scanJobId);
      else log("warn", "ignoring scan request for unconfigured CIDR", s);
  } catch (e) { log("warn", "heartbeat failed", { error: String(e) }); }
}

async function periodic(): Promise<void> {
  for (const cidr of cfg.NETWORK_CIDRS) {
    if (ctrl.signal.aborted) return;
    if (!primaryCidrs.has(cidr)) { log("debug", "standby for network, skipping periodic scan", { cidr }); continue; }
    await runScan(cidr, null);
  }
}

async function main(): Promise<void> {
  await loadOui(cfg.OUI_FILE);
  await post("/collectors/register", { collectorId: cfg.COLLECTOR_ID, version: VERSION, hostname: osHostname(), cidrs: cfg.NETWORK_CIDRS });
  log("info", "registered", { cidrs: cfg.NETWORK_CIDRS, interval: cfg.SCAN_INTERVAL });
  const hb = setInterval(() => void heartbeat(), cfg.HEARTBEAT_INTERVAL * 1000);
  const sc = setInterval(() => void periodic(), cfg.SCAN_INTERVAL * 1000);
  await heartbeat(); void periodic();
  if (cfg.ENABLE_NETFLOW) {
    const nf = startNetflow({ port: cfg.NETFLOW_PORT, cidrs: cfg.NETWORK_CIDRS, allowedExporters: cfg.NETFLOW_EXPORTERS, flushSec: cfg.NETFLOW_FLUSH_SEC, onFlush: async (w) => {
      const r = await post<{ stored: number; unmatched: number }>("/collectors/ingest/traffic", {
        kind: "NETFLOW_V5", exporterIp: w.exporterIp, intervalStart: w.intervalStart.toISOString(), intervalEnd: w.intervalEnd.toISOString(),
        hosts: [...w.hosts].slice(0, 4096).map(([ip, h]) => ({ ip, ...h })), unsupportedVersions: [...w.unsupportedVersions],
      });
      log("info", "netflow window uploaded", { exporter: w.exporterIp, hosts: w.hosts.size, ...r });
    } });
    ctrl.signal.addEventListener("abort", () => nf.close());
  }
  const stop = (sig: string) => { log("info", "shutting down", { sig }); ctrl.abort(); clearInterval(hb); clearInterval(sc); setTimeout(() => process.exit(0), busy ? 5000 : 0); };
  process.on("SIGTERM", () => stop("SIGTERM")); process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((e) => { log("error", "fatal", { error: String(e) }); process.exit(1); });
