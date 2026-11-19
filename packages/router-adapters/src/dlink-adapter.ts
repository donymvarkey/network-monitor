import { createHmac } from "node:crypto";
import type { PollResult, RouterAdapter, RouterTarget } from "./types";
import { httpGet, icmp, summarize } from "./util";

/**
 * D-Link adapter (R15 AX1500 target).
 *
 * NOTHING here is assumed to work on a given firmware. On every poll the adapter *probes*:
 *  1. ICMP reachability.
 *  2. Whether the web UI answers on HTTP(S).
 *  3. Whether an HNAP endpoint (/HNAP1/) exists and returns a SOAP envelope.
 *  4. Only if HNAP answered: HNAP login, then GetDeviceSettings / GetClientInfo.
 * Each capability is marked SUPPORTED only if the response was parsed successfully; otherwise
 * UNSUPPORTED/ERROR with the reason. If your firmware does not expose HNAP, the router will show
 * "Unsupported" with availability only — that is the correct, honest result.
 */
const NS = "http://purenetworks.com/HNAP1/";
const env = (action: string, body = "") => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${action} xmlns="${NS}">${body}</${action}></soap:Body></soap:Envelope>`;
const tag = (xml: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1];
const hmac = (key: string, msg: string) => createHmac("md5", key).update(msg).digest("hex").toUpperCase();

async function hnap(base: string, action: string, body: string, timeoutMs: number, auth?: { privateKey: string; cookie: string }) {
  const headers: Record<string, string> = { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${NS}${action}"` };
  if (auth) {
    const ts = String(Date.now() % 2000000000000);
    headers["HNAP_AUTH"] = `${hmac(auth.privateKey, ts + `"${NS}${action}"`)} ${ts}`;
    headers["Cookie"] = `uid=${auth.cookie}`;
  }
  const r = await httpGet(`${base}/HNAP1/`, timeoutMs, { method: "POST", headers, body: env(action, body) });
  return r ? { status: r.status, text: await r.text() } : null;
}

export const dlinkAdapter: RouterAdapter = {
  method: "DLINK_HNAP",
  async poll(t: RouterTarget): Promise<PollResult> {
    const caps: PollResult["capabilities"] = {};
    const p = await icmp(t.managementIp, t.timeoutMs);
    caps.availability = { state: "SUPPORTED" }; caps.managementIp = { state: "SUPPORTED" };
    for (const k of ["identification", "model", "firmware", "lanIp", "wanIp", "interfaces", "interfaceStats", "dhcpClients", "connectedClients", "uptime", "clientTraffic"] as const) caps[k] = { state: "UNTESTED" };

    let base = `http://${t.managementIp}`;
    let web = await httpGet(base + "/", t.timeoutMs);
    if (!web) { base = `https://${t.managementIp}`; web = await httpGet(base + "/", t.timeoutMs); }
    if (!web) return { status: p.alive ? "UNSUPPORTED" : "UNREACHABLE", error: "Web management interface not reachable", reachable: p.alive, latencyMs: p.latencyMs, capabilities: markAll(caps, "UNSUPPORTED", "Web UI unreachable") };

    const probe = await hnap(base, "GetDeviceSettings", "", t.timeoutMs);
    if (!probe || !/soap:Envelope/i.test(probe.text)) {
      return { status: "UNSUPPORTED", error: "No HNAP endpoint on this firmware", reachable: true, latencyMs: p.latencyMs, capabilities: markAll(caps, "UNSUPPORTED", "HNAP (/HNAP1/) not exposed by firmware") };
    }
    // Unauthenticated GetDeviceSettings is answered by some D-Link firmwares.
    const model = tag(probe.text, "ModelName"), fw = tag(probe.text, "FirmwareVersion"), vendor = tag(probe.text, "VendorName");
    if (model) caps.model = { state: "SUPPORTED" }; if (fw) caps.firmware = { state: "SUPPORTED" };
    if (model || vendor) caps.identification = { state: "SUPPORTED" };

    const user = t.credentials?.username ?? "Admin", pass = t.credentials?.password;
    if (!pass) return { status: summarize(finalize(caps, "No credentials configured"), true), reachable: true, latencyMs: p.latencyMs, capabilities: caps, identity: { model, firmware: fw, manufacturer: vendor } };

    // HNAP login challenge
    const ch = await hnap(base, "Login", `<Action>request</Action><Username>${user}</Username><LoginPassword></LoginPassword><Captcha></Captcha>`, t.timeoutMs);
    const challenge = ch && tag(ch.text, "Challenge"), cookie = ch && tag(ch.text, "Cookie"), pub = ch && tag(ch.text, "PublicKey");
    if (!challenge || !cookie || !pub) return { status: summarize(finalize(caps, "HNAP login not supported"), true), error: "HNAP login challenge not offered", reachable: true, latencyMs: p.latencyMs, capabilities: caps, identity: { model, firmware: fw, manufacturer: vendor } };
    const privateKey = hmac(pub + pass, challenge);
    const login = await hnap(base, "Login", `<Action>login</Action><Username>${user}</Username><LoginPassword>${hmac(privateKey, challenge)}</LoginPassword><Captcha></Captcha>`, t.timeoutMs, { privateKey, cookie });
    if (!login || tag(login.text, "LoginResult") !== "success") {
      return { status: "AUTH_FAILED", error: "D-Link authentication failed", reachable: true, latencyMs: p.latencyMs, capabilities: finalizeObj(caps, "Authentication failed"), identity: { model, firmware: fw } };
    }
    const auth = { privateKey, cookie };
    const result: PollResult = { status: "PARTIAL", reachable: true, latencyMs: p.latencyMs, capabilities: caps, identity: { model, firmware: fw, manufacturer: vendor ?? "D-Link" } };

    const clients = await hnap(base, "GetClientInfo", "", t.timeoutMs, auth);
    if (clients && /GetClientInfoResult>OK/.test(clients.text)) {
      const list = [...clients.text.matchAll(/<ClientInfo>([\s\S]*?)<\/ClientInfo>/g)].map((m) => {
        // <Type> is e.g. "LAN", "WiFi_2.4G", "WiFi_5G" on HNAP firmwares that report it; absent => connection stays unknown.
        const type = tag(m[1]!, "Type") ?? "";
        const connection = /wifi|wlan|wireless/i.test(type) ? "WIRELESS" as const : /^lan|ethernet|wired/i.test(type) ? "WIRED" as const : undefined;
        return { mac: (tag(m[1]!, "MacAddress") ?? "").toLowerCase(), ip: tag(m[1]!, "IPv4Address"), hostname: tag(m[1]!, "DeviceName") || tag(m[1]!, "NickName"), connection };
      }).filter((c) => c.mac);
      result.clients = list; caps.connectedClients = { state: "SUPPORTED", detail: "HNAP GetClientInfo" };
    } else caps.connectedClients = { state: "UNSUPPORTED", detail: "GetClientInfo not available" };
    // GetClientInfo carries no byte counters, so per-client traffic is not available from this router.
    caps.clientTraffic = { state: "UNSUPPORTED", detail: "HNAP GetClientInfo reports no per-client byte counters" };

    const wan = await hnap(base, "GetWanSettings", "", t.timeoutMs, auth);
    const wanIp = wan && tag(wan.text, "IPAddress");
    if (wanIp) { result.wanIp = wanIp; caps.wanIp = { state: "SUPPORTED" }; } else caps.wanIp = { state: "UNSUPPORTED", detail: "GetWanSettings not available" };

    const lan = await hnap(base, "GetRouterLanSettings", "", t.timeoutMs, auth);
    const lanIp = lan && tag(lan.text, "RouterIPAddress");
    if (lanIp) { result.lanIp = lanIp; caps.lanIp = { state: "SUPPORTED" }; } else caps.lanIp = { state: "UNSUPPORTED", detail: "GetRouterLanSettings not available" };

    finalize(caps, "Not exposed via HNAP on this firmware");
    result.status = summarize(caps as Record<string, { state: string }>, true);
    return result;
  },
};

function markAll(c: PollResult["capabilities"], state: "UNSUPPORTED", detail: string) {
  for (const k of Object.keys(c) as (keyof typeof c)[]) if (k !== "availability" && k !== "managementIp" && c[k]?.state !== "SUPPORTED") c[k] = { state, detail };
  return c;
}
function finalizeObj(c: PollResult["capabilities"], detail: string) { for (const k of Object.keys(c) as (keyof typeof c)[]) if (c[k]?.state === "UNTESTED") c[k] = { state: "UNTESTED", detail }; return c; }
function finalize(c: PollResult["capabilities"], detail: string) { for (const k of Object.keys(c) as (keyof typeof c)[]) if (c[k]?.state === "UNTESTED") c[k] = { state: "UNSUPPORTED", detail }; return c as Record<string, { state: string }>; }
