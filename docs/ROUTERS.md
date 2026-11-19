# Router integrations — verified capabilities and limitations

**Nothing in this file is claimed to work on your specific hardware.** Each integration probes on every
poll and stores per-capability results (`RouterCapability`). The UI shows exactly what was observed.

## Topology assumptions
ISP router (LAN A) → D-Link R15 in Router Mode (NAT, LAN B) → Docker host on LAN B.
- A collector on LAN B can see LAN B devices only. Devices on LAN A are hidden behind the R15's NAT.
  To inventory LAN A, run a **second collector** on a host plugged into the ISP router's LAN with its own
  `NETWORK_CONTEXT` (e.g. `isp-lan`).
- Router polling runs in the **worker** (on the Docker host). From LAN B the worker can reach the R15's LAN IP
  and, through NAT, usually the ISP router's LAN IP. If not, ICMP/HTTP to it will show *Unreachable*.

## Adapters
| Method | What it reads | Never assumed |
|---|---|---|
| ICMP | availability, latency | everything else = unsupported |
| HTTP_PROBE (generic ISP router) | availability + presence of a web UI (HTTP status / Server header) | model, firmware, clients, WAN |
| SNMP_V2C / SNMP_V3 | standard MIB-II only: sysDescr, sysName, sysUpTime, ifTable (incl. counters), ipNetToMedia (router ARP table) | firmware (no standard OID), DHCP leases (no standard MIB), vendor MIBs |
| DLINK_HNAP | probes `/HNAP1/`; if present: GetDeviceSettings (model/firmware), HNAP login, GetClientInfo, GetWanSettings, GetRouterLanSettings | anything that doesn't return a parsable `…Result>OK` response |

## D-Link R15 (AX1500, EAGLE PRO AI) — status
- **Not verified against your installed firmware.** I could not test hardware.
- SNMP: not advertised for this consumer model — do not expect it. Use ICMP or DLINK_HNAP.
- HNAP: older D-Link routers expose `/HNAP1/`. Newer EAGLE PRO firmwares may use a different, undocumented
  web API. The adapter detects this and reports **Unsupported** rather than scraping unknown endpoints.
- How to verify: add the router with method DLINK_HNAP, press **Test connection**, and read the
  Capabilities panel. Record results here:

| Capability | Result on firmware ____ |
|---|---|
| Model / firmware | |
| Connected clients | |
| WAN IP | |
| LAN IP | |
| Interfaces / stats | (not exposed via HNAP) |
| Uptime | (not exposed via HNAP) |

## Security
- Credentials are encrypted with AES-256-GCM (`ROUTER_CREDENTIALS_KEY`) before storage and never returned
  by any API (`routerDto` strips them; responses show only `hasCredentials`).
- Credentials are write-only in the UI; audit logs record `[changed]`/`[cleared]`, never values.
- Router create/update/delete/test require the ADMIN role.
