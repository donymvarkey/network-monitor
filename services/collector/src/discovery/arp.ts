import { readFile } from "node:fs/promises";
import { ipInCidr } from "@netmon/network-core";
import { run, has } from "../exec.js";

export interface ArpEntry { ip: string; mac: string }
const MAC = /([0-9a-f]{1,2}(:[0-9a-f]{1,2}){5})/i;

function normalizeMac(mac: string): string {
  return mac
    .split(":")
    .map((part) => part.padStart(2, "0").toLowerCase())
    .join(":");
}

/** Active ARP sweep with arp-scan (needs CAP_NET_RAW). Restricted to the given CIDR. */
export async function arpScan(cidr: string, iface?: string): Promise<ArpEntry[]> {
  if (!(await has("arp-scan"))) throw new Error("arp-scan not installed");
  const args = ["--plain", "--quiet", "--retry=2", ...(iface ? ["--interface", iface] : []), cidr];
  const r = await run("arp-scan", args, 120_000);
  if (r.code !== 0 && !r.stdout) throw new Error(`arp-scan failed: ${r.stderr.trim()}`);
  return r.stdout.split("\n").map((l) => l.split("\t")).filter((p) => p[0] && p[1] && MAC.test(p[1]))
    .map((p) => ({ ip: p[0]!, mac: normalizeMac(p[1]!) })).filter((e) => ipInCidr(e.ip, cidr));
}

/** Passive: kernel neighbour table (populated after pings). No special privileges. Supports Linux and macOS. */
export async function neighbourTable(cidr: string): Promise<ArpEntry[]> {
  const out: ArpEntry[] = [];

  // macOS / BSD: arp -an
  if (process.platform === "darwin") {
  const rMac = await run("arp", ["-an"], 5000);
  if (rMac.code === 0 && rMac.stdout.trim().length > 0) {
    for (const line of rMac.stdout.split("\n")) {
      // Formats: ? (192.168.1.1) at 14:eb:b6:66:a7:e0 on en0 ifscope [ethernet]
      const ipMatch = /\(([\d.]+)\)/.exec(line);
      const match = MAC.exec(line);
      if (ipMatch && match) {
        const ip = ipMatch[1];
        const rawMac = match[1];
        if (ip && rawMac && !/incomplete/i.test(line) && ipInCidr(ip, cidr)) {
          out.push({ ip, mac: normalizeMac(rawMac) });
        }
      }
    }
    return out;
  }
  return out;
  }

  // Linux: ip neigh show
  const rLinux = await run("ip", ["-4", "neigh", "show"], 5000);
  if (rLinux.code === 0 && rLinux.stdout.trim().length > 0) {
    for (const line of rLinux.stdout.split("\n")) {
      const ip = line.trim().split(/\s+/)[0];
      const match = MAC.exec(line);
      if (ip && match && match[1] !== "00:00:00:00:00:00" && !/FAILED|INCOMPLETE/.test(line) && ipInCidr(ip, cidr)) {
        out.push({ ip, mac: normalizeMac(match[1]!) });
      }
    }
    return out;
  }

  // Linux fallback: /proc/net/arp
  const text = await readFile("/proc/net/arp", "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    const ip = line.trim().split(/\s+/)[0];
    const match = MAC.exec(line);
    if (ip && match && match[1] !== "00:00:00:00:00:00" && !/FAILED|INCOMPLETE/.test(line) && ipInCidr(ip, cidr)) {
      out.push({ ip, mac: normalizeMac(match[1]!) });
    }
  }

  return out;
}
