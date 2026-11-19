import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().regex(/^-?[a-zA-Z]+$/).optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const createNetworkSchema = z.object({
  name: z.string().min(1).max(100),
  cidr: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/),
  description: z.string().max(500).optional(),
});

// ---------- Phase 2 ----------
const mac = z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i).transform((v) => v.toLowerCase());
const ip = z.string().ip();

export const deviceListQuery = paginationSchema.extend({
  status: z.enum(["ONLINE", "OFFLINE", "UNKNOWN"]).optional(),
  networkId: z.string().uuid().optional(),
  collectorId: z.string().uuid().optional(),
  category: z.string().max(50).optional(),
  sort: z.enum(["name", "-name", "lastSeenAt", "-lastSeenAt", "status", "-status", "vendor", "-vendor"]).optional(),
});

export const updateDeviceSchema = z.object({
  displayName: z.string().trim().max(100).nullable().optional(),
  category: z.string().trim().max(50).nullable().optional(),
  deviceType: z.string().trim().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict();

export const mergeDeviceSchema = z.object({ sourceDeviceId: z.string().uuid() });

export const collectorRegisterSchema = z.object({
  collectorId: z.string().min(1).max(100),
  version: z.string().max(40),
  hostname: z.string().max(255),
  cidrs: z.array(z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/)).min(1).max(32),
});

export const heartbeatSchema = z.object({
  version: z.string().max(40),
  uptimeSec: z.number().int().nonnegative(),
  activeScanId: z.string().uuid().nullable(),
});

export const observationSchema = z.object({
  ip,
  mac: mac.optional(),
  hostname: z.string().max(255).optional(),
  vendor: z.string().max(255).optional(),
  methods: z.array(z.enum(["ARP", "ICMP", "NMAP"])).min(1),
  reachable: z.boolean(),
  latencyMs: z.number().nonnegative().optional(),
  macRandomized: z.boolean().default(false),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  icmpBlocked: z.boolean().default(false),
  observedAt: z.string().datetime(),
});
export type Observation = z.infer<typeof observationSchema>;

export const ingestDevicesSchema = z.object({
  cidr: z.string(),
  scanJobId: z.string().uuid().nullable(),
  observations: z.array(observationSchema).max(4096),
});

export const ingestEventsSchema = z.object({
  events: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("scan.started"), scanJobId: z.string().uuid(), hostsTotal: z.number().int() }),
    z.object({ type: z.literal("scan.progress"), scanJobId: z.string().uuid(), hostsScanned: z.number().int(), devicesFound: z.number().int() }),
    z.object({ type: z.literal("scan.completed"), scanJobId: z.string().uuid(), devicesFound: z.number().int() }),
    z.object({ type: z.literal("scan.failed"), scanJobId: z.string().uuid(), error: z.string().max(2000) }),
    z.object({ type: z.literal("scan.error"), scanJobId: z.string().uuid().nullable(), error: z.string().max(2000) }),
  ])).max(100),
});

// ---------- Phase 3 ----------
export function isValidCidr(c: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(c);
  if (!m) return false;
  const oct = m.slice(1, 5).map(Number); const bits = Number(m[5]);
  if (oct.some((o) => o > 255) || bits > 32) return false;
  const n = oct.reduce((a, o) => (a << 8) + o, 0) >>> 0;
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return ((n & mask) >>> 0) === n; // must be the network address
}
export const cidr = z.string().trim().refine(isValidCidr, "Invalid CIDR (must be a network address, e.g. a.b.c.0/24)");
const ipv4 = z.string().ip({ version: "v4" });

export const networkUpsertSchema = z.object({
  name: z.string().trim().min(1).max(100),
  cidr,
  context: z.string().trim().regex(/^[a-z0-9-]{1,40}$/, "lowercase letters, digits, dashes").default("default"),
  gateway: ipv4.nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  offlineThreshold: z.number().int().min(1).max(20).optional(),
  routerId: z.string().uuid().nullable().optional(),
  collectors: z.array(z.object({ collectorId: z.string().uuid(), isPrimary: z.boolean() })).max(10).optional(),
});

export const routerCredentialsSchema = z.object({
  username: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
  community: z.string().max(100).optional(),
  snmpUser: z.string().max(100).optional(),
  authKey: z.string().max(200).optional(),
  privKey: z.string().max(200).optional(),
}).strict();

export const routerCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  manufacturer: z.string().trim().max(100).nullable().optional(),
  model: z.string().trim().max(100).nullable().optional(),
  managementIp: ipv4,
  networkId: z.string().uuid(),
  integrationMethod: z.enum(["NONE", "ICMP", "SNMP_V2C", "SNMP_V3", "DLINK_HNAP", "HTTP_PROBE"]),
  pollIntervalSec: z.number().int().min(15).max(3600).default(60),
  assignedCollectorId: z.string().uuid().nullable().optional(),
  credentials: routerCredentialsSchema.nullable().optional(),
});
export const routerUpdateSchema = routerCreateSchema.partial().extend({
  /** Omit to keep, null to clear, object to replace. */
  credentials: routerCredentialsSchema.nullable().optional(),
});

// ---------- Phase 4 ----------
export const latencyResultSchema = z.object({
  ip: z.string().ip(),
  sent: z.number().int().min(1).max(20),
  received: z.number().int().min(0).max(20),
  minMs: z.number().nonnegative().nullable(),
  avgMs: z.number().nonnegative().nullable(),
  maxMs: z.number().nonnegative().nullable(),
  measuredAt: z.string().datetime(),
}).refine((r) => r.received <= r.sent, "received > sent");

export const ingestLatencySchema = z.object({
  monitorTaskId: z.string().uuid(),
  results: z.array(latencyResultSchema).max(4096),
});

export const monitoringSettingsSchema = z.object({
  monitorIntervalSec: z.number().int().min(15).max(3600),
  pingCount: z.number().int().min(1).max(10),
  offlineThreshold: z.number().int().min(1).max(20).optional(),
}).strict();

export const eventQuerySchema = paginationSchema.extend({
  category: z.string().regex(/^[a-z]+$/).optional(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
  deviceId: z.string().uuid().optional(),
  routerId: z.string().uuid().optional(),
  networkId: z.string().uuid().optional(),
  collectorId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export type EventQuery = z.infer<typeof eventQuerySchema>;

export const chartRangeSchema = z.enum(["24h", "7d", "30d"]).default("24h");

// ---------- Phase 5 ----------
export const trafficRangeSchema = z.enum(["1h", "6h", "24h", "7d", "30d"]).default("24h");
/** Collector-aggregated flow totals per host. Only header counters; flow payloads are never sent. */
export const ingestTrafficSchema = z.object({
  kind: z.enum(["NETFLOW_V5"]),
  exporterIp: ipv4,
  intervalStart: z.string().datetime(),
  intervalEnd: z.string().datetime(),
  hosts: z.array(z.object({ ip: ipv4, downloadBytes: z.number().int().min(0), uploadBytes: z.number().int().min(0), packets: z.number().int().min(0) })).max(4096),
  unsupportedVersions: z.array(z.number().int()).max(16).default([]),
});
export type IngestTraffic = z.infer<typeof ingestTrafficSchema>;
export const topologyLayoutSchema = z.object({ positions: z.array(z.object({ id: z.string().min(1).max(80), x: z.number().finite(), y: z.number().finite() })).max(5000) });
export const interfaceRoleSchema = z.object({ role: z.enum(["WAN", "LAN", "OTHER"]) });

// ---------- Phase 6 ----------
export const alertRuleTypeSchema = z.enum(["DEVICE_OFFLINE", "DEVICE_ONLINE", "ROUTER_OFFLINE", "COLLECTOR_DISCONNECTED", "HIGH_LATENCY", "HIGH_PACKET_LOSS", "HIGH_BANDWIDTH", "NETWORK_UNAVAILABLE", "MONITORING_FAILURE"]);
export const severitySchema = z.enum(["INFO", "WARNING", "CRITICAL"]);
const uuidOrNull = z.string().uuid().nullable().optional();
/** Explicit allow-list of fields (no mass assignment of ids, timestamps or evaluation state). */
export const alertRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: alertRuleTypeSchema,
  networkId: uuidOrNull,
  deviceId: uuidOrNull,
  routerId: uuidOrNull,
  threshold: z.number().finite().min(0).max(1e12).nullable().optional(),
  windowMin: z.number().int().min(1).max(1440).default(10),
  evalIntervalSec: z.number().int().min(15).max(86_400).default(60),
  cooldownSec: z.number().int().min(0).max(7 * 86_400).default(900),
  severity: severitySchema.default("WARNING"),
  notifyEmail: z.boolean().default(true),
  enabled: z.boolean().default(true),
}).superRefine((r, ctx) => {
  if (["HIGH_LATENCY", "HIGH_PACKET_LOSS", "HIGH_BANDWIDTH"].includes(r.type) && (r.threshold === null || r.threshold === undefined)) ctx.addIssue({ code: "custom", path: ["threshold"], message: "Threshold is required for this rule type" });
  if (r.type === "HIGH_PACKET_LOSS" && r.threshold != null && r.threshold > 1) ctx.addIssue({ code: "custom", path: ["threshold"], message: "Packet loss threshold is a fraction between 0 and 1" });
});
export const alertRulePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  threshold: z.number().finite().min(0).max(1e12).nullable().optional(),
  windowMin: z.number().int().min(1).max(1440).optional(),
  evalIntervalSec: z.number().int().min(15).max(86_400).optional(),
  cooldownSec: z.number().int().min(0).max(7 * 86_400).optional(),
  severity: severitySchema.optional(),
  notifyEmail: z.boolean().optional(),
  enabled: z.boolean().optional(),
  networkId: uuidOrNull, deviceId: uuidOrNull, routerId: uuidOrNull,
}).strict();
export const alertActionSchema = z.object({ action: z.enum(["acknowledge", "resolve"]) });
export const alertListSchema = z.object({ state: z.enum(["active", "OPEN", "ACKNOWLEDGED", "RESOLVED", "all"]).default("active"), severity: severitySchema.optional() });
export const channelSchema = z.object({
  type: z.enum(["EMAIL", "WEBHOOK", "TELEGRAM", "DISCORD"]),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  minSeverity: severitySchema.default("WARNING"),
  recipients: z.array(z.string().trim().email().max(254)).max(20).default([]),
}).superRefine((c, ctx) => { if (c.type === "EMAIL" && c.recipients.length === 0) ctx.addIssue({ code: "custom", path: ["recipients"], message: "At least one recipient is required" }); });
export const channelPatchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional(), minSeverity: severitySchema.optional(), recipients: z.array(z.string().trim().email().max(254)).max(20).optional() }).strict();
