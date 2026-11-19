import type { PollResult, RouterAdapter, RouterTarget } from "./types";
import { icmp } from "./util";

/** Generic adapter: availability only. Explicitly marks everything else unsupported. */
export const icmpAdapter: RouterAdapter = {
  method: "ICMP",
  async poll(t: RouterTarget): Promise<PollResult> {
    const p = await icmp(t.managementIp, t.timeoutMs);
    return {
      status: p.alive ? "UNSUPPORTED" : "UNREACHABLE", reachable: p.alive, latencyMs: p.latencyMs,
      capabilities: {
        availability: { state: "SUPPORTED" }, managementIp: { state: "SUPPORTED" },
        identification: { state: "UNSUPPORTED", detail: "ICMP only" }, lanIp: { state: "UNSUPPORTED" }, wanIp: { state: "UNSUPPORTED" },
        firmware: { state: "UNSUPPORTED" }, model: { state: "UNSUPPORTED" }, interfaces: { state: "UNSUPPORTED" },
        dhcpClients: { state: "UNSUPPORTED" }, connectedClients: { state: "UNSUPPORTED" }, interfaceStats: { state: "UNSUPPORTED" }, uptime: { state: "UNSUPPORTED" }, clientTraffic: { state: "UNSUPPORTED", detail: "ICMP carries no traffic data" },
      },
    };
  },
};
