import { icmpAdapter } from "./icmp-adapter";
import { snmpAdapter } from "./snmp-adapter";
import { dlinkAdapter } from "./dlink-adapter";
import { httpProbeAdapter } from "./http-probe-adapter";
import type { RouterAdapter } from "./types";
export * from "./types";
export * from "./crypto";

export function adapterFor(method: string): RouterAdapter | null {
  switch (method) {
    case "ICMP": return icmpAdapter;
    case "SNMP_V2C": return snmpAdapter(false);
    case "SNMP_V3": return snmpAdapter(true);
    case "DLINK_HNAP": return dlinkAdapter;
    case "HTTP_PROBE": return httpProbeAdapter;
    default: return null;
  }
}
export { pollRouter } from "./poll-service";
