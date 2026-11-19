import snmp from "net-snmp";
import type { PollResult, RouterAdapter, RouterInterfaceInfo, RouterTarget } from "./types";
import { icmp, summarize } from "./util";

// Standard MIB-II / IF-MIB / IP-MIB OIDs only. Vendor MIBs are not assumed.
const SYS_DESCR = "1.3.6.1.2.1.1.1.0", SYS_UPTIME = "1.3.6.1.2.1.1.3.0", SYS_NAME = "1.3.6.1.2.1.1.5.0";
const IF_DESCR = "1.3.6.1.2.1.2.2.1.2", IF_SPEED = "1.3.6.1.2.1.2.2.1.5", IF_MAC = "1.3.6.1.2.1.2.2.1.6", IF_OPER = "1.3.6.1.2.1.2.2.1.8";
const IF_IN = "1.3.6.1.2.1.2.2.1.10", IF_OUT = "1.3.6.1.2.1.2.2.1.16", IF_ERR = "1.3.6.1.2.1.2.2.1.14";
const IP_NET_TO_MEDIA = "1.3.6.1.2.1.4.22.1.2"; // ARP table on the router

function session(t: RouterTarget, v3: boolean) {
  const opts = { timeout: t.timeoutMs, retries: 1 };
  if (!v3) return snmp.createSession(t.managementIp, t.credentials?.community ?? "public", { ...opts, version: snmp.Version2c });
  return snmp.createV3Session(t.managementIp, {
    name: t.credentials?.snmpUser ?? "", level: t.credentials?.privKey ? snmp.SecurityLevel.authPriv : snmp.SecurityLevel.authNoPriv,
    authProtocol: snmp.AuthProtocols.sha, authKey: t.credentials?.authKey ?? "", privProtocol: snmp.PrivProtocols.aes, privKey: t.credentials?.privKey ?? "",
  }, opts);
}
const get = (s: snmp.Session, oids: string[]) => new Promise<snmp.Varbind[]>((res, rej) => s.get(oids, (e, vb) => (e ? rej(e) : res(vb ?? []))));
// Some agents never finish a walk of an empty subtree (endOfMibView handling); a hard deadline keeps a poll from hanging.
const walk = (s: snmp.Session, oid: string, deadlineMs = 8000) => new Promise<snmp.Varbind[]>((res, rej) => {
  const out: snmp.Varbind[] = [];
  const t = setTimeout(() => (out.length ? res(out) : rej(new Error(`SNMP walk of ${oid} timed out`))), deadlineMs);
  s.subtree(oid, 20, (vbs) => { out.push(...vbs.filter((v) => !snmp.isVarbindError(v))); }, (e) => { clearTimeout(t); if (e) rej(e); else res(out); });
});
const idx = (oid: string) => Number(oid.split(".").pop());
const mac = (b: unknown) => Buffer.isBuffer(b) && b.length === 6 ? [...b].map((x) => x.toString(16).padStart(2, "0")).join(":") : undefined;

export function snmpAdapter(v3: boolean): RouterAdapter {
  return {
    method: v3 ? "SNMP_V3" : "SNMP_V2C",
    async poll(t): Promise<PollResult> {
      const p = await icmp(t.managementIp, t.timeoutMs);
      const caps: PollResult["capabilities"] = { availability: { state: "SUPPORTED" }, managementIp: { state: "SUPPORTED" } };
      const s = session(t, v3);
      try {
        const vb = await get(s, [SYS_DESCR, SYS_UPTIME, SYS_NAME]);
        const descr = String(vb[0]?.value ?? ""); const uptime = Number(vb[1]?.value ?? 0) / 100;
        caps.identification = { state: "SUPPORTED", detail: String(vb[2]?.value ?? "") };
        caps.uptime = { state: "SUPPORTED" };
        caps.model = { state: descr ? "SUPPORTED" : "UNSUPPORTED", detail: descr || undefined };
        caps.firmware = { state: "UNSUPPORTED", detail: "Not in standard MIB-II; sysDescr shown under model" };
        let interfaces: RouterInterfaceInfo[] | undefined;
        try {
          const [d, sp, m, o, i, out, err] = await Promise.all([IF_DESCR, IF_SPEED, IF_MAC, IF_OPER, IF_IN, IF_OUT, IF_ERR].map((x) => walk(s, x, t.timeoutMs * 3)));
          interfaces = d!.map((v) => {
            const k = idx(v.oid); const f = (a: snmp.Varbind[]) => a.find((x) => idx(x.oid) === k)?.value;
            return { ifIndex: k, name: String(v.value), speedMbps: Number(f(sp!) ?? 0) / 1e6 || undefined, macAddress: mac(f(m!)), isUp: f(o!) === 1, rxBytes: BigInt(Number(f(i!) ?? 0)), txBytes: BigInt(Number(f(out!) ?? 0)), errors: Number(f(err!) ?? 0) };
          });
          caps.interfaces = { state: interfaces.length ? "SUPPORTED" : "UNSUPPORTED" };
          caps.interfaceStats = { state: interfaces.length ? "SUPPORTED" : "UNSUPPORTED" };
        } catch (e) { caps.interfaces = { state: "ERROR", detail: String(e) }; caps.interfaceStats = { state: "ERROR", detail: String(e) }; }
        let clients: PollResult["clients"];
        try {
          const arp = await walk(s, IP_NET_TO_MEDIA, t.timeoutMs * 2);
          clients = arp.map((v) => ({ mac: mac(v.value) ?? "", ip: v.oid.split(".").slice(-4).join(".") })).filter((c) => c.mac);
          caps.connectedClients = { state: clients.length ? "SUPPORTED" : "UNSUPPORTED", detail: "From router ARP table (ipNetToMedia)" };
        } catch (e) { caps.connectedClients = { state: "ERROR", detail: String(e) }; }
        caps.dhcpClients = { state: "UNSUPPORTED", detail: "No standard DHCP lease MIB" };
        caps.clientTraffic = { state: "UNSUPPORTED", detail: "Standard MIBs have no per-client byte counters; interface counters only" };
        caps.lanIp = { state: "UNTESTED" }; caps.wanIp = { state: "UNTESTED" };
        return { status: summarize(caps as Record<string, { state: string }>, true), reachable: true, latencyMs: p.latencyMs, capabilities: caps, identity: { model: descr || undefined }, uptimeSec: uptime, interfaces, clients };
      } catch (e) {
        const msg = String(e);
        const auth = /authentication|unknownUserName|wrongDigest/i.test(msg);
        for (const k of ["identification", "uptime", "model", "firmware", "interfaces", "interfaceStats", "connectedClients", "dhcpClients", "lanIp", "wanIp", "clientTraffic"] as const)
          caps[k] = { state: auth ? "ERROR" : "UNSUPPORTED", detail: auth ? "SNMP authentication failed" : "SNMP did not respond" };
        return { status: auth ? "AUTH_FAILED" : p.alive ? "UNSUPPORTED" : "UNREACHABLE", error: auth ? "SNMP authentication failed" : `SNMP: ${msg}`, reachable: p.alive, latencyMs: p.latencyMs, capabilities: caps };
      } finally { s.close(); }
    },
  };
}
