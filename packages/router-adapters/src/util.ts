import { execFile } from "node:child_process";

export function icmp(ip: string, timeoutMs: number): Promise<{ alive: boolean; latencyMs?: number }> {
  return new Promise((resolve) => {
    execFile("ping", ["-n", "-c", "1", "-W", String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip], { timeout: timeoutMs + 1000 }, (err, stdout) => {
      const m = /time[=<]([\d.]+)\s*ms/.exec(String(stdout));
      resolve({ alive: !err, latencyMs: m ? Number(m[1]) : undefined });
    });
  });
}

export async function httpGet(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response | null> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: c.signal, redirect: "manual" }); } catch { return null; } finally { clearTimeout(t); }
}

export function summarize(caps: Record<string, { state: string }>, reachable: boolean): "CONNECTED" | "PARTIAL" | "UNSUPPORTED" | "UNREACHABLE" {
  if (!reachable) return "UNREACHABLE";
  const s = Object.values(caps);
  const ok = s.filter((c) => c.state === "SUPPORTED").length;
  const beyondBasic = Object.entries(caps).filter(([k, v]) => v.state === "SUPPORTED" && k !== "availability" && k !== "managementIp").length;
  if (beyondBasic === 0) return "UNSUPPORTED";
  return ok === s.length ? "CONNECTED" : "PARTIAL";
}
