import type { PollResult, RouterAdapter, RouterTarget } from "./types";
import { httpGet, icmp } from "./util";

/** For unknown ISP routers: availability via ICMP + confirms a management web UI exists. Nothing else is claimed. */
export const httpProbeAdapter: RouterAdapter = {
  method: "HTTP_PROBE",
  async poll(t: RouterTarget): Promise<PollResult> {
    const p = await icmp(t.managementIp, t.timeoutMs);
    const r = (await httpGet(`http://${t.managementIp}/`, t.timeoutMs)) ?? (await httpGet(`https://${t.managementIp}/`, t.timeoutMs));
    const server = r?.headers.get("server") ?? undefined;
    const reachable = p.alive || !!r;
    const no = { state: "UNSUPPORTED" as const, detail: "No API integration for this router" };
    return {
      status: reachable ? "UNSUPPORTED" : "UNREACHABLE", reachable, latencyMs: p.latencyMs,
      capabilities: { availability: { state: "SUPPORTED" }, managementIp: { state: "SUPPORTED" }, identification: r ? { state: "SUPPORTED", detail: `Web UI HTTP ${r.status}${server ? `, server: ${server}` : ""}` } : no,
        model: no, firmware: no, lanIp: no, wanIp: no, interfaces: no, interfaceStats: no, dhcpClients: no, connectedClients: no, uptime: no, clientTraffic: no },
    };
  },
};
