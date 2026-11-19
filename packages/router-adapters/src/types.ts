export const CAPABILITIES = [
  "identification", "availability", "managementIp", "lanIp", "wanIp", "firmware", "model",
  "interfaces", "dhcpClients", "connectedClients", "interfaceStats", "uptime",
  // Phase 5: per-client byte counters reported by the router itself (the only per-device source a router can give).
  "clientTraffic",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type CapState = "SUPPORTED" | "UNSUPPORTED" | "UNTESTED" | "ERROR";
export type IntegrationStatus = "CONNECTED" | "PARTIAL" | "UNSUPPORTED" | "AUTH_FAILED" | "UNREACHABLE";

export interface RouterTarget {
  managementIp: string;
  credentials: { username?: string; password?: string; community?: string; snmpUser?: string; authKey?: string; privKey?: string } | null;
  timeoutMs: number;
}
export interface RouterInterfaceInfo { name: string; ifIndex?: number; macAddress?: string; speedMbps?: number; isUp?: boolean; rxBytes?: bigint; txBytes?: bigint; errors?: number }
/** rxBytes/txBytes are CUMULATIVE counters from the router's perspective of the client (rx = client downloaded). Only set when the router really reports them. */
export interface RouterClient { mac: string; ip?: string; hostname?: string; leaseEnd?: string; connection?: "WIRED" | "WIRELESS"; rxBytes?: bigint; txBytes?: bigint }

export interface PollResult {
  status: IntegrationStatus;
  error?: string;
  reachable: boolean;
  latencyMs?: number;
  capabilities: Partial<Record<Capability, { state: CapState; detail?: string }>>;
  identity?: { model?: string; firmware?: string; manufacturer?: string };
  lanIp?: string; wanIp?: string; wanUp?: boolean; uptimeSec?: number;
  interfaces?: RouterInterfaceInfo[];
  clients?: RouterClient[];
}

/** Every adapter reports what it actually observed; anything not observed is UNSUPPORTED/UNTESTED, never assumed. */
export interface RouterAdapter {
  readonly method: string;
  poll(target: RouterTarget): Promise<PollResult>;
}

export class AuthError extends Error {}
