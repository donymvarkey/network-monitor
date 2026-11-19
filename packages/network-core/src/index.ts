export const REDIS_EVENTS_CHANNEL = "netmon:events";
export const QUEUES = {
  monitoring: "monitoring",
  scans: "periodic-scans",
  aggregation: "metric-aggregation",
  alerts: "alert-evaluation",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Locally administered bit set => likely a randomized/private MAC. */
export function isRandomizedMac(mac: string): boolean {
  const first = parseInt(mac.slice(0, 2), 16);
  return (first & 0b10) === 0b10;
}
export function macOui(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase();
}
export function cidrHosts(cidr: string): string[] {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (!base || !Number.isInteger(bits) || bits < 16 || bits > 32) throw new Error(`Unsupported CIDR ${cidr} (allowed /16-/32)`);
  const n = base.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  const net = (n & mask) >>> 0;
  const size = 2 ** (32 - bits);
  const out: string[] = [];
  const start = size > 2 ? 1 : 0, end = size > 2 ? size - 1 : size;
  for (let i = start; i < end; i++) {
    const v = (net + i) >>> 0;
    out.push([24, 16, 8, 0].map((s) => (v >>> s) & 255).join("."));
  }
  return out;
}
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, b] = cidr.split("/");
  const toN = (x: string) => x.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
  const bits = Number(b);
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return ((toN(ip) & mask) >>> 0) === ((toN(base ?? "0.0.0.0") & mask) >>> 0);
}
export const QUEUE_DISCOVERY = "discovery-dispatch";
export const QUEUE_STALE = "device-staleness";
export const QUEUE_ROUTER_POLL = "router-poll";

// ---------- Phase 4 ----------
export const QUEUE_MONITOR = "monitor-schedule";
export const QUEUE_MONITOR_RESULTS = "monitor-results";
export const QUEUE_AGGREGATE = QUEUES.aggregation;

export type DeviceStatusValue = "UNKNOWN" | "ONLINE" | "OFFLINE";
/** Status machine shared by discovery ingest and the monitoring worker. */
export function nextDeviceStatus(current: DeviceStatusValue, reachable: boolean, failures: number, threshold: number): DeviceStatusValue {
  if (reachable) return "ONLINE";
  if (failures >= threshold) return "OFFLINE";
  return current;
}

/** Event category is the prefix of the event type (device.offline -> device). */
export const EVENT_CATEGORIES = ["device", "router", "collector", "scan", "network", "alert", "monitor"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export function eventCategory(type: string): string { return type.split(".")[0] ?? "system"; }

/** Parses iputils (Linux) and BSD/macOS ping summaries. Returns null if the output has no summary. */
export function parsePingSummary(out: string): { sent: number; received: number; minMs: number | null; avgMs: number | null; maxMs: number | null } | null {
  const c = /(\d+) packets transmitted, (\d+) (?:packets )?received/.exec(out);
  if (!c) return null;
  const sent = Number(c[1]), received = Number(c[2]);
  const r = /(?:rtt|round-trip) min\/avg\/max\/(?:mdev|stddev) = ([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(out);
  return { sent, received, minMs: r ? Number(r[1]) : null, avgMs: r ? Number(r[2]) : null, maxMs: r ? Number(r[3]) : null };
}

export interface HealthInputs {
  online: number; offline: number;
  routersUp: number; routersTotal: number;
  collectorsUp: number; collectorsTotal: number;
  packetLoss: number | null;
}
/**
 * 0..100 weighted score over the components that actually have data:
 * device availability 40%, router availability 20%, collector availability 20%, (1 - packet loss) 20%.
 * Unknown-status devices are excluded. Returns null when no component has data.
 */
export function computeHealthScore(h: HealthInputs): number | null {
  const parts: [number, number][] = [];
  if (h.online + h.offline > 0) parts.push([h.online / (h.online + h.offline), 0.4]);
  if (h.routersTotal > 0) parts.push([h.routersUp / h.routersTotal, 0.2]);
  if (h.collectorsTotal > 0) parts.push([h.collectorsUp / h.collectorsTotal, 0.2]);
  if (h.packetLoss !== null) parts.push([1 - h.packetLoss, 0.2]);
  if (!parts.length) return null;
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return Math.round((parts.reduce((a, [v, x]) => a + v * x, 0) / w) * 1000) / 10;
}

// ---------- Phase 5 ----------
export const QUEUE_TRAFFIC = "traffic-aggregate";

/** Traffic page ranges: raw samples back the short ranges, hourly rollups the long ones. */
export const TRAFFIC_RANGES = {
  "1h": { ms: 3_600_000, bucketSec: 60, rollup: false },
  "6h": { ms: 6 * 3_600_000, bucketSec: 300, rollup: false },
  "24h": { ms: 24 * 3_600_000, bucketSec: 900, rollup: false },
  "7d": { ms: 7 * 86_400_000, bucketSec: 3600, rollup: true },
  "30d": { ms: 30 * 86_400_000, bucketSec: 6 * 3600, rollup: true },
} as const;
export type TrafficRange = keyof typeof TRAFFIC_RANGES;

/** Interface role from its name. Unknown names are OTHER so they never inflate totals. */
export function guessInterfaceRole(name: string): "WAN" | "LAN" | "OTHER" {
  const n = name.toLowerCase();
  if (/^(lo|loopback)|null|dummy|tunl|sit\d|ip6tnl|gre/.test(n)) return "OTHER";
  if (/wan|ppp|internet|pon|dsl|nas\d|veip/.test(n)) return "WAN";
  if (/^br-?lan|^br\d|lan|wlan|wifi|ra\d|ath\d|eth\d|wl\d/.test(n)) return "LAN";
  return "OTHER";
}

/**
 * Byte delta between two cumulative counter readings. Returns null (= no sample, not zero) when
 * the counter was reset (reboot) or the delta is implausible for the interface speed.
 * 32-bit wraps are handled when `bits` is 32.
 */
export function counterDelta(prev: bigint, cur: bigint, seconds: number, speedMbps: number | null, bits: 32 | 64 = 32): bigint | null {
  if (seconds <= 0) return null;
  let d = cur - prev;
  if (d < 0n) {
    if (bits === 32 && prev > 0xC0000000n) d = cur + (0x100000000n - prev); // plausible wrap near the top
    else return null; // reset
  }
  const maxBytes = speedMbps ? BigInt(Math.ceil((speedMbps * 1e6 / 8) * seconds * 1.1)) : null;
  if (maxBytes !== null && d > maxBytes) return null;
  return d;
}

export const CATEGORY_KIND: Record<string, "computer" | "phone" | "iot" | "switch" | "router" | "unknown"> = {
  Computer: "computer", Server: "computer", Printer: "iot", Phone: "phone", Tablet: "phone",
  "TV / Media": "iot", IoT: "iot", Camera: "iot", Network: "switch", Switch: "switch", "Access point": "switch", Router: "router",
};
export function deviceKind(category: string | null | undefined, deviceType?: string | null): "computer" | "phone" | "iot" | "switch" | "router" | "unknown" {
  if (category && CATEGORY_KIND[category]) return CATEGORY_KIND[category]!;
  const t = (deviceType ?? "").toLowerCase();
  if (/switch|access point|\bap\b/.test(t)) return "switch";
  if (/router|gateway/.test(t)) return "router";
  return "unknown";
}

// ---------------- Phase 6: alerting ----------------
export const QUEUE_ALERTS = "alert-evaluate";
export const QUEUE_NOTIFY = "notify-deliver";
export const QUEUE_MAINTENANCE = "maintenance";

export const ALERT_RULE_TYPES = [
  "DEVICE_OFFLINE", "DEVICE_ONLINE", "ROUTER_OFFLINE", "COLLECTOR_DISCONNECTED", "HIGH_LATENCY",
  "HIGH_PACKET_LOSS", "HIGH_BANDWIDTH", "NETWORK_UNAVAILABLE", "MONITORING_FAILURE",
] as const;
export type AlertRuleTypeValue = (typeof ALERT_RULE_TYPES)[number];

/** Types that compare a measured number against the rule threshold. */
export const THRESHOLD_TYPES: readonly AlertRuleTypeValue[] = ["HIGH_LATENCY", "HIGH_PACKET_LOSS", "HIGH_BANDWIDTH"];
/** DEVICE_ONLINE is an event-style rule: it fires once and resolves itself. */
export const ONE_SHOT_TYPES: readonly AlertRuleTypeValue[] = ["DEVICE_ONLINE"];

export function alertFingerprint(ruleId: string, target: string): string { return `${ruleId}:${target}`; }

/**
 * A threshold condition only fires on real measurements: null (no data) never triggers and never
 * resolves — "unavailable" must not look like "healthy" or "broken".
 */
export function thresholdBreached(value: number | null | undefined, threshold: number | null | undefined): boolean | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (threshold === null || threshold === undefined) return null;
  return value > threshold;
}

/** Offline-type conditions: true once the target has been down for at least `minDownMin` minutes. */
export function downLongEnough(downSince: Date | null, now: Date, minDownMin: number | null | undefined): boolean {
  if (!downSince) return false;
  return now.getTime() - downSince.getTime() >= Math.max(0, minDownMin ?? 0) * 60_000;
}

/** Re-notify for a still-open alert only after the cooldown has elapsed since the last notification. */
export function shouldNotify(lastNotifiedAt: Date | null, now: Date, cooldownSec: number): boolean {
  if (!lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= cooldownSec * 1000;
}

/** Rules run on their own interval even though the worker ticks more often. */
export function ruleDue(lastEvaluatedAt: Date | null, now: Date, evalIntervalSec: number): boolean {
  if (!lastEvaluatedAt) return true;
  return now.getTime() - lastEvaluatedAt.getTime() >= evalIntervalSec * 1000 * 0.95;
}

export type AlertAction = "open" | "touch" | "resolve" | "none";
/** Lifecycle decision for one (rule, target) pair. ACKNOWLEDGED alerts stay acknowledged while still breached. */
export function alertTransition(existing: "OPEN" | "ACKNOWLEDGED" | null, breached: boolean | null): AlertAction {
  if (breached === null) return existing ? "touch" : "none";
  if (breached) return existing ? "touch" : "open";
  return existing ? "resolve" : "none";
}

const SEVERITY_ORDER = { INFO: 0, WARNING: 1, CRITICAL: 2 } as const;
export function severityAtLeast(s: keyof typeof SEVERITY_ORDER, min: keyof typeof SEVERITY_ORDER): boolean {
  return SEVERITY_ORDER[s] >= SEVERITY_ORDER[min];
}

/** Masks secrets before anything is logged (tokens, passwords, bearer headers). */
export function redact(input: unknown): unknown {
  const KEY = /pass(word)?|secret|token|authorization|credential|apikey|api_key/i;
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, KEY.test(k) ? "[redacted]" : redact(v)]));
  }
  if (typeof input === "string") return input.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
  return input;
}
