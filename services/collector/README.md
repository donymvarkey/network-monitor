# Network Collector (Phase 2)

Linux Node.js agent that discovers devices **only within the CIDRs you configure** and reports to the Next.js API.
Flow: collector → `POST /api/v1/collectors/*` → PostgreSQL → Redis → Socket.IO → browser.

## 1. Provision a collector
```bash
docker compose exec web pnpm collector:create living-room
# prints COLLECTOR_ID and a one-time COLLECTOR_TOKEN (only its hash is stored)
```

## 2. Configure
| Variable | Default | Meaning |
|---|---|---|
| COLLECTOR_ID | — | Name printed by `collector:create` |
| COLLECTOR_TOKEN | — | Token printed by `collector:create` |
| API_BASE_URL | — | e.g. `http://192.168.1.10:3000` |
| NETWORK_CIDRS | — | Comma-separated private ranges, /16–/32, e.g. `192.168.1.0/24` |
| SCAN_INTERVAL | 300 | Seconds between automatic rediscovery |
| PING_TIMEOUT | 1000 | ms per ICMP echo |
| ENABLE_ARP / ENABLE_ICMP / ENABLE_NMAP | true / true / false | Discovery engines |
| SCAN_INTERFACE | auto | Interface for arp-scan |
| SCAN_CONCURRENCY | 64 | Parallel pings |

Public (non-RFC1918) ranges are rejected at startup.

## 3. Run
Docker (recommended): uncomment nothing — use the `collector` profile:
```bash
docker compose --profile collector up -d collector
```
The container uses `network_mode: host` (ARP needs the LAN segment), drops all capabilities and adds only `NET_RAW`. It is **not** privileged.

Bare metal:
```bash
sudo apt install iputils-ping iproute2 arp-scan nmap ieee-data
sudo setcap cap_net_raw+ep $(command -v arp-scan)
pnpm --filter @netmon/collector dev
```

## Linux tools and permissions
- `ping` (iputils) — ICMP; works unprivileged via `net.ipv4.ping_group_range` or file caps.
- `ip neigh` (iproute2) — reads the kernel neighbour table; no privileges.
- `arp-scan` — active ARP; needs `CAP_NET_RAW`.
- `nmap -sn` (optional) — host discovery only, no port scans; needs `CAP_NET_RAW`.
- IEEE `oui.txt` — vendor lookup (bundled in the image).

## Availability rules
- A device answering ARP but not ICMP is flagged *ICMP blocked* and judged by ARP.
- Missing hosts are reported with a consecutive-failure count; the API marks them offline only after the network's `offlineThreshold` (default 3).
- Every status change is stored in `DeviceStatusTransition` and emitted as `device:online` / `device:offline`.
