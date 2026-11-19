import { run } from "../exec.js";

export interface PingResult { ip: string; alive: boolean; latencyMs?: number }

const isMac = process.platform === "darwin";

/** One ICMP echo via iputils `ping` (setuid / CAP_NET_RAW or ping_group_range). */
export async function ping(ip: string, timeoutMs: number): Promise<PingResult> {
  // On macOS (Darwin) ping -W expects milliseconds, on Linux it expects seconds
  const w = isMac ? timeoutMs : Math.max(1, Math.ceil(timeoutMs / 1000));
  const r = await run("ping", ["-n", "-c", "1", "-W", String(w), ip], timeoutMs + 1000);
  const m = /time[=<]([\d.]+)\s*ms/.exec(r.stdout);
  return { ip, alive: r.code === 0, latencyMs: m ? Number(m[1]) : undefined };
}

export async function pingMany(ips: string[], timeoutMs: number, concurrency: number, onProgress?: (done: number) => void): Promise<Map<string, PingResult>> {
  const results = new Map<string, PingResult>();
  let i = 0, done = 0;
  async function lane(): Promise<void> {
    while (i < ips.length) {
      const ip = ips[i++]!;
      results.set(ip, await ping(ip, timeoutMs));
      done++; if (done % 16 === 0) onProgress?.(done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, lane));
  onProgress?.(done);
  return results;
}
