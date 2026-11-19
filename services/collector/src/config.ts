import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const schema = z.object({
  COLLECTOR_ID: z.string().min(1),
  COLLECTOR_TOKEN: z.string().min(20),
  API_BASE_URL: z.string().url(),
  SCAN_INTERVAL: z.coerce.number().int().min(30).default(300),     // seconds between full rediscovery
  PING_TIMEOUT: z.coerce.number().int().min(100).max(10_000).default(1000), // ms
  NETWORK_CIDRS: z.string().min(1).transform((s) => s.split(",").map((c) => c.trim()).filter(Boolean)),
  ENABLE_ARP: bool.default("true"),
  ENABLE_ICMP: bool.default("true"),
  ENABLE_NMAP: bool.default("false"),
  HEARTBEAT_INTERVAL: z.coerce.number().int().min(5).default(20),
  SCAN_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(64),
  OUI_FILE: z.string().optional(),
  SCAN_INTERFACE: z.string().optional(),
  // Phase 4 monitoring: parallel probes and seconds between echo requests (non-root Linux minimum is 0.2; macOS needs root below 1).
  MONITOR_CONCURRENCY: z.coerce.number().int().min(1).max(128).default(32),
  PROBE_INTERVAL: z.coerce.number().min(0.2).max(5).default(process.platform === "darwin" ? 1 : 0.2),
  // Phase 5 traffic: NetFlow v5 receiver (router/switch must export to this host). Off by default.
  ENABLE_NETFLOW: bool.default("false"),
  NETFLOW_PORT: z.coerce.number().int().min(1).max(65535).default(2055),
  NETFLOW_EXPORTERS: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  NETFLOW_FLUSH_SEC: z.coerce.number().int().min(10).max(600).default(60),
  NETWORK_CONTEXT: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
});

export type Config = z.infer<typeof schema>;
export function loadConfig(): Config {
  const c = schema.parse(process.env);
  for (const cidr of c.NETWORK_CIDRS) {
    if (!/^\d{1,3}(\.\d{1,3}){3}\/(1[6-9]|2\d|3[0-2])$/.test(cidr)) throw new Error(`Invalid or too-large CIDR "${cidr}" (allowed /16–/32)`);
    const first = Number(cidr.split(".")[0]);
    const priv = first === 10 || cidr.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(cidr);
    if (!priv) throw new Error(`Refusing to scan non-private range ${cidr}`);
  }
  return c;
}
