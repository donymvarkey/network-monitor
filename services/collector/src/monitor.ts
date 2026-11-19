import { parsePingSummary } from "@netmon/network-core";
import { run } from "./exec.js";

export interface MonitorTask { monitorTaskId: string; targets: string[]; pingCount: number; timeoutMs: number }
export interface LatencyResult { ip: string; sent: number; received: number; minMs: number | null; avgMs: number | null; maxMs: number | null; measuredAt: string }

const isMac = process.platform === "darwin";

/** N echo requests to one target; min/avg/max and loss come from ping's own summary line. */
export async function probe(ip: string, count: number, timeoutMs: number, intervalSec: number): Promise<LatencyResult> {
  const w = isMac ? timeoutMs : Math.max(1, Math.ceil(timeoutMs / 1000));
  const budget = Math.ceil(count * intervalSec * 1000 + timeoutMs + 2000);
  const r = await run("ping", ["-n", "-c", String(count), "-i", String(intervalSec), "-W", String(w), ip], budget);
  const s = parsePingSummary(r.stdout);
  return { ip, sent: s?.sent || count, received: s?.received ?? 0, minMs: s?.minMs ?? null, avgMs: s?.avgMs ?? null, maxMs: s?.maxMs ?? null, measuredAt: new Date().toISOString() };
}

export async function runMonitorTask(t: MonitorTask, concurrency: number, intervalSec: number, signal: AbortSignal): Promise<LatencyResult[]> {
  const out: LatencyResult[] = [];
  let i = 0;
  async function lane(): Promise<void> {
    while (i < t.targets.length && !signal.aborted) {
      const ip = t.targets[i++]!;
      out.push(await probe(ip, t.pingCount, t.timeoutMs, intervalSec));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, t.targets.length) }, lane));
  return out;
}
