import { createSocket, type Socket } from "node:dgram";
import { ipInCidr } from "@netmon/network-core";
import { log } from "../log.js";

/**
 * NetFlow v5 receiver. Only the fixed v5 header and flow-record counters are decoded
 * (addresses, packet and byte counts). NetFlow carries no packet payloads and none are stored.
 * v9 / IPFIX (v10) datagrams are counted and reported as "received but not decoded" so the UI can
 * say so honestly instead of showing zero traffic.
 */
export interface HostTotals { downloadBytes: number; uploadBytes: number; packets: number }
export interface FlowWindow { exporterIp: string; intervalStart: Date; intervalEnd: Date; hosts: Map<string, HostTotals>; unsupportedVersions: Set<number> }

const ip4 = (b: Buffer, o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;

/** Pure decoder (exported for tests). Returns null for non-v5 or malformed datagrams. */
export function decodeV5(msg: Buffer): { sampling: number; records: { src: string; dst: string; packets: number; bytes: number }[] } | null {
  if (msg.length < 24 || msg.readUInt16BE(0) !== 5) return null;
  const count = msg.readUInt16BE(2);
  if (count < 1 || count > 30 || msg.length < 24 + count * 48) return null;
  const sampling = msg.readUInt16BE(22) & 0x3fff; // low 14 bits = 1:N sampling interval, 0 = unsampled
  const records = [];
  for (let i = 0; i < count; i++) {
    const o = 24 + i * 48;
    records.push({ src: ip4(msg, o), dst: ip4(msg, o + 4), packets: msg.readUInt32BE(o + 16), bytes: msg.readUInt32BE(o + 20) });
  }
  return { sampling, records };
}

export function startNetflow(opts: { port: number; cidrs: string[]; allowedExporters: string[]; flushSec: number; onFlush: (w: FlowWindow) => Promise<void> }): Socket {
  const windows = new Map<string, FlowWindow>();
  const local = (ip: string) => opts.cidrs.some((c) => ipInCidr(ip, c));
  const sock = createSocket("udp4");
  sock.on("message", (msg, rinfo) => {
    if (opts.allowedExporters.length && !opts.allowedExporters.includes(rinfo.address)) return;
    let w = windows.get(rinfo.address);
    if (!w) { w = { exporterIp: rinfo.address, intervalStart: new Date(), intervalEnd: new Date(), hosts: new Map(), unsupportedVersions: new Set() }; windows.set(rinfo.address, w); }
    const v = msg.length >= 2 ? msg.readUInt16BE(0) : 0;
    const d = decodeV5(msg);
    if (!d) { w.unsupportedVersions.add(v); return; }
    const mult = d.sampling > 1 ? d.sampling : 1;
    const add = (ip: string, k: "downloadBytes" | "uploadBytes", bytes: number, pk: number) => {
      const h = w!.hosts.get(ip) ?? { downloadBytes: 0, uploadBytes: 0, packets: 0 };
      h[k] += bytes * mult; h.packets += pk * mult; w!.hosts.set(ip, h);
    };
    for (const r of d.records) {
      // Attribute only to hosts inside this collector's networks; external endpoints are never stored.
      if (local(r.src)) add(r.src, "uploadBytes", r.bytes, r.packets);
      if (local(r.dst)) add(r.dst, "downloadBytes", r.bytes, r.packets);
    }
  });
  sock.on("error", (e) => log("error", "netflow socket error", { error: String(e) }));
  sock.bind(opts.port, () => log("info", "netflow v5 listener started", { port: opts.port }));
  setInterval(() => {
    for (const [k, w] of windows) {
      windows.delete(k);
      w.intervalEnd = new Date();
      if (!w.hosts.size && !w.unsupportedVersions.size) continue;
      void opts.onFlush(w).catch((e) => log("warn", "netflow upload failed", { error: String(e) }));
    }
  }, opts.flushSec * 1000).unref();
  return sock;
}
