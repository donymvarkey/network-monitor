/**
 * Per-IP availability state kept in collector memory.
 * A device is only reported unreachable with a failure count; the API applies the
 * network's offline threshold, so a single failed ping never flips a device offline.
 * Devices that answer ARP but never ICMP are flagged icmpBlocked and judged by ARP.
 */
interface State { failures: number; everIcmp: boolean; mac?: string; lastSeen?: number }
const state = new Map<string, State>();

export function record(ip: string, opts: { arp: boolean; icmp: boolean; mac?: string }): { reachable: boolean; failures: number; icmpBlocked: boolean } {
  const s = state.get(ip) ?? { failures: 0, everIcmp: false };
  if (opts.icmp) s.everIcmp = true;
  if (opts.mac) s.mac = opts.mac;
  const icmpBlocked = !s.everIcmp && opts.arp;
  const reachable = opts.icmp || opts.arp;
  s.failures = reachable ? 0 : s.failures + 1;
  if (reachable) s.lastSeen = Date.now();
  state.set(ip, s);
  return { reachable, failures: s.failures, icmpBlocked };
}
export function known(): [string, State][] { return [...state.entries()]; }
