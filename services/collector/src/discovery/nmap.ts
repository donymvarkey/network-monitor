import { run, has } from "../exec.js";
import { ipInCidr } from "@netmon/network-core";

export interface NmapHost { ip: string; mac?: string; vendor?: string; hostname?: string }

/** Optional engine: host discovery only (-sn), no port scanning. */
export async function nmapSweep(cidr: string): Promise<NmapHost[]> {
  if (!(await has("nmap"))) throw new Error("nmap not installed");
  const r = await run("nmap", ["-sn", "-n", "--privileged", "-oG", "-", cidr], 300_000);
  if (r.code !== 0) throw new Error(`nmap failed: ${r.stderr.trim()}`);
  const hosts: NmapHost[] = [];
  for (const line of r.stdout.split("\n")) {
    const m = /^Host: (\S+) \(([^)]*)\)\s+Status: Up/.exec(line);
    if (m && ipInCidr(m[1]!, cidr)) hosts.push({ ip: m[1]!, hostname: m[2] || undefined });
  }
  return hosts;
}
