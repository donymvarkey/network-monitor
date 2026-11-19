# Network Monitor (Phases 1 – 6)

A self-hosted home and small-office network monitoring platform. It combines a Next.js web application with a distributed background worker, a real-time WebSocket event gateway, pluggable router probes, and a standalone discovery collector agent.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [What Is Implemented (Phases 1 – 5)](#what-is-implemented-phases-1--5)
3. [Prerequisites](#prerequisites)
4. [Automated Setup (`scripts/setup.sh`)](#automated-setup-scriptssetupsh)
5. [Step-by-Step Manual Setup (Dev Mode)](#step-by-step-manual-setup-dev-mode)
6. [Collector Agent Setup](#collector-agent-setup)
7. [Router Integration & Capabilities](#router-integration--capabilities)
8. [Running Scans & Managing Devices](#running-scans--managing-devices)
9. [Troubleshooting & Gotchas Encountered](#troubleshooting--gotchas-encountered)
10. [Useful Commands & Operations Cheatsheet](#useful-commands--operations-cheatsheet)
11. [Production Deployment (Docker)](#production-deployment-docker)
12. [Upgrading an Existing Phase 3 Install to Phase 4](#upgrading-an-existing-phase-3-install-to-phase-4)
13. [Phase 4: Monitoring Engine Reference](#phase-4-monitoring-engine-reference)
14. [Upgrading a Phase 4 Install to Phase 5](#upgrading-a-phase-4-install-to-phase-5)
15. [Phase 5: Topology & Traffic Reference](#phase-5-topology--traffic-reference)

---

## Architecture Overview

```text
+-----------------------------------------------------------------------------------+
|                                 Next.js Web App                                   |
|                             (http://localhost:3000)                               |
|   Dashboard UI  *  Auth & Session  *  REST API (/api/v1)  *  Prisma Client        |
+-------------------+-----------------------------+-------------------+-------------+
                    |                             |                   |
            Database|                     Pub/Sub |          Enqueues |
                    v                             v                   v
            +---------------+             +---------------+   +-----------------+
            |  PostgreSQL   |             |  Redis 7.2    |   |  Worker Service |
            |  (Port 5432)  |             |  (Port 6379)  |   |  (BullMQ queues)|
            +---------------+             +-------+-------+   +-----------------+
                                                  |
                                                  v
                                          +---------------+
                                          | Realtime GW   |
                                          | Socket.IO:4001|
                                          +---------------+
                                                  ^
                                                  | Ingest API & Heartbeat
                                          +-------+-------+
                                          |   Collector   |
                                          | ICMP/ARP Agent|
                                          +---------------+
```

* **`apps/web`**: Next.js App Router UI, session-based auth, REST API routes (`/api/v1`), Prisma schema and migrations.
* **`services/worker`**: BullMQ background worker executing scheduled router polls, scan dispatches, and metrics jobs.
* **`services/realtime`**: Socket.IO gateway relaying Redis Pub/Sub events directly to connected browser clients.
* **`services/collector`**: Lightweight Node.js discovery daemon running ICMP ping sweeps and kernel ARP lookups, reporting back via authenticated HTTP REST.
* **`packages/shared-types`**, **`packages/shared-validation`**, **`packages/network-core`**, **`packages/router-adapters`**: Shared libraries for type safety, Zod schemas, network calculations, and router hardware adapters.

---

## What Is Implemented (Phases 1 – 6)

### Phase 1 — Platform Foundation
* Next.js 14 / React with Tailwind CSS dark monitoring theme.
* Session authentication with argon2 password hashing, secure cookies, and audit logging.
* PostgreSQL relational database via Prisma with full schemas for devices, networks, routers, alerts, and audit records.
* Redis Pub/Sub event pipeline and WebSocket notifications.
* Docker Compose multi-service architecture.

### Phase 2 — Network Discovery & Device Inventory
* Standalone Collector agent (`services/collector`) registering with the core platform via secure token.
* ICMP ping sweep engine and ARP neighbour table inspection (supporting Linux `ip neigh` and macOS `arp -an`).
* Primary device identity keyed on MAC address (prevents DHCP lease duplicates).
* Flagging of randomized MAC addresses (locally administered bit detection).
* IP address lease history (`validFrom` / `validTo`).
* Single-threshold offline state machine (only marks offline after $N$ consecutive missed pings).
* Manual and scheduled subnet discovery scans with live progress reporting.

### Phase 3 — Router Integration & Multi-Network
* Multi-network contexts (e.g. `default`, `isp-lan`, `r15-lan`), allowing overlapping subnets across distinct network segments.
* Pluggable router adapters:
  * **ICMP**: Reachability and round-trip ping latency.
  * **Generic HTTP Probe**: Probes web management server, parses headers (e.g. Boa, lighttpd, nginx), tests latency without credentials.
  * **SNMP v2c / v3**: Standard MIB-II interface counters and system metrics.
  * **D-Link HNAP**: Probed SOAP/XML authentication for modern D-Link routers.
* AES-256-GCM encrypted credential storage (`ROUTER_CREDENTIALS_KEY`).
* Honest capability matrix: explicit dashboard reporting of what is `SUPPORTED`, `UNSUPPORTED`, or `UNTESTED` on each router model.

---

### Phase 4 — Live Dashboard & Real-Time Monitoring
* **Overview dashboard**: device totals (online / offline / unknown), active routers, networks, collectors up/down; health score, average latency, packet loss, router and collector availability; six history charts (24h / 7d / 30d); recent discoveries, disconnections, router events, alerts and network changes. Every number comes from database records — nothing is generated.
* **Monitoring engine (worker)**: every network's primary collector is asked to ping all known devices on a per-network interval. Rounds are de-duplicated, retried, time-limited and recorded on failure; they survive worker restarts.
* **Latency & packet loss**: measured by the collector (`ping -c N`), stored per device with min / avg / max / loss, rolled up hourly for charts.
* **Live updates**: Socket.IO events fan out through Redis Pub/Sub; the header shows *Live / Reconnecting… / Live updates offline*. Only affected data refreshes — no page reloads, no polling.
* **Device page tabs**: Overview, History (status transitions, IP changes, discovery events), Metrics (latency, loss, availability), Information (notes, category, identifiers, collector observations).
* **Events & Logs**: search, filters (category, severity, device, router, network, collector, date range), server-side pagination, expandable details, CSV export.
* **Settings**: per-network interval / pings per target / offline threshold, round counts, recent job failures.

### Phase 6 — Security, Alerting, Reliability & Production
Session hardening, collector token rotation/revocation, alert rules with in-app and email notifications, verified backups, system health page, HTTPS, maintenance scripts and automated tests. Full reference: [Phase 6 Reference](#phase-6-reference).

### Phase 5 — Network Topology & Traffic Analytics
* **Topology** (`/topology`): interactive React Flow map (zoom, pan, drag-to-move with saved positions, fit to screen, refresh, reset layout). Filters by network, device category and offline devices. Double-click a router or device to open its details.
* Every link carries **evidence** (Verified / Configured / Inferred / Unknown), connection type, discovery source, confidence and last-verified time. Inferred links are drawn dotted and are never shown as physical cables; "device on a subnet" is shown as a logical membership.
* **Traffic** (`/traffic`): totals, current rates, history (1h / 6h / 24h / 7d / 30d), by device / network / router, top consumers, interface utilisation, source status, last updated. Missing data shows **Unavailable**, never `0`.
* **Device → Traffic tab**: usage, history, current speed, data source — or a plain explanation of why there is no data.
* Traffic sources: SNMP interface counters (per-interface), NetFlow v5 on the collector (per-device), router per-client counters when a router API really reports them. IPFIX is detected and reported as not decoded; sFlow and packet capture are not implemented / disabled.

## Prerequisites

* **Docker & Docker Compose v2**: Installed and running (e.g. Docker Desktop on macOS or `docker.io` + `docker-compose-v2` on Linux).
* **Node.js**: v20+ LTS (Node v20 or v22 recommended).
* **pnpm**: v9.x (`corepack enable && corepack prepare pnpm@9.12.0 --activate` or `npm install -g pnpm@9`).
* **OpenSSL**: For secret generation.

---

## Automated Setup (`scripts/setup.sh`)

The easiest way to bootstrap the entire environment:

```bash
# 1. Make the setup script executable
chmod +x scripts/setup.sh

# 2. Run automated development setup
./scripts/setup.sh dev
```

### What `setup.sh dev` automates:
1. Validates prerequisites (Docker, Node, pnpm, OpenSSL).
2. Generates `.env` with strong cryptographically random keys (`SESSION_SECRET`, `ADMIN_PASSWORD`, `ROUTER_CREDENTIALS_KEY`, `POSTGRES_PASSWORD`).
3. Creates `apps/web/.env` with `localhost` mappings for the local web process.
4. Starts PostgreSQL and Redis containers in Docker and waits until healthy.
5. Runs `pnpm install` and generates Prisma client.
6. Runs `prisma migrate dev` and seeds the admin user.
7. Builds and starts `worker` and `realtime` containers in Docker.

Once complete:
```bash
# Start the web UI in dev mode
pnpm dev
```
Open **`http://localhost:3000`** and log in with the admin credentials printed by the script (or found in `.env`).

---

## Step-by-Step Manual Setup (Dev Mode)

If you prefer running every step manually:

### 1. Configure Root `.env`
```bash
cp .env.example .env
```
Ensure `.env` contains:
```env
POSTGRES_DB=netmon
POSTGRES_USER=netmon
POSTGRES_PASSWORD=generate_a_strong_password
DATABASE_URL=postgresql://netmon:generate_a_strong_password@postgres:5432/netmon?schema=public
REDIS_URL=redis://redis:6379
SESSION_SECRET=generate_32_byte_base64_secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=generate_admin_password
ROUTER_CREDENTIALS_KEY=generate_32_byte_base64_secret
NEXT_PUBLIC_API_URL=http://localhost:3000
REALTIME_PORT=4001
# Phase 4: the browser connects to /socket.io on the dashboard's own address.
# In dev, Next.js forwards it here; in Docker, nginx does. Do NOT set NEXT_PUBLIC_REALTIME_URL.
REALTIME_INTERNAL_URL=http://localhost:4001
```

### 2. Configure `apps/web/.env` (For Local Dev)
Because the Next.js app runs on your host machine while Postgres and Redis run in Docker, create `apps/web/.env` with `localhost` addresses:
```bash
sed -e "s|@postgres:5432|@localhost:5432|" -e "s|redis://redis:|redis://localhost:|" .env > apps/web/.env
chmod 600 apps/web/.env
```

### 3. Start Database and Cache in Docker
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```
Verify they are healthy:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

### 4. Install Dependencies & Migrate Database
```bash
pnpm install

# Export DATABASE_URL pointing to localhost for Prisma on host
export DATABASE_URL="postgresql://netmon:<POSTGRES_PASSWORD>@localhost:5432/netmon?schema=public"

# Generate Prisma client
pnpm --filter web exec prisma generate

# Run database migrations
pnpm --filter web exec prisma migrate dev --name init

# Seed initial admin user
pnpm --filter web db:seed
```

### 5. Build and Start Background Containers
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build worker realtime
```

### 6. Launch the Web App
```bash
pnpm dev
```
Access the dashboard at **`http://localhost:3000`**.

---

## Collector Agent Setup

The collector is the agent that sweeps your subnet and inspects ARP tables.

### 1. Create a Collector in the Web App
Run the generator CLI from the project root:
```bash
pnpm --filter web collector:create den-collector
```
Output:
```text
COLLECTOR_ID=den-collector
COLLECTOR_TOKEN=random_base64_token_here
```

### 2. Create `.env.collector`
In the project root, create `.env.collector`:
```env
COLLECTOR_ID=den-collector
COLLECTOR_TOKEN=random_base64_token_here
API_BASE_URL=http://localhost:3000
NETWORK_CIDRS=192.168.1.0/24
NETWORK_CONTEXT=default
SCAN_INTERVAL=300
PING_TIMEOUT=1000
ENABLE_ARP=true
ENABLE_ICMP=true
ENABLE_NMAP=false
```

> **Crucial Settings:**
> * `ENABLE_ARP=true`: Essential for collecting MAC addresses so devices are uniquely identified and saved to inventory.
> * `PING_TIMEOUT=1000`: Set to 1000ms. On macOS, `ping -W 1000` treats timeout in milliseconds, whereas on Linux `ping -W 1` is seconds. The collector automatically handles this platform difference.

### 3. Run the Collector
In a dedicated terminal tab:
```bash
export $(grep -v '^#' .env.collector | xargs) && pnpm --filter @netmon/collector dev
```

Expected startup logs:
```text
{"level":"info","svc":"collector","msg":"registered","cidrs":["192.168.1.0/24"],"interval":300}
{"level":"info","svc":"collector","msg":"scan started","cidr":"192.168.1.0/24","scanJobId":null}
{"level":"info","svc":"collector","msg":"scan completed","cidr":"192.168.1.0/24","observations":4,"reachable":4}
```

---

## Router Integration & Capabilities

To monitor your gateway or ISP router (e.g. DEN Broadband / Genexis GPON ONT):

1. Go to **Routers** (`/routers`) and click **Add router**.
2. Select the parent Network (`192.168.1.0/24`).
3. Enter:
   * **Name**: `DEN ONT Gateway`
   * **IP Address**: `192.168.1.1`
   * **Integration Method**: Select **Generic: ping + web UI probe** (`HTTP_PROBE`) or **Ping only** (`ICMP`).
4. Click **Test Connection**:
   * The system will probe `192.168.1.1` via ICMP ping and HTTP.
   * If running Boa web server (common on Genexis/Syrotech ONTs), it captures the server fingerprint (`Boa/0.93.15`), round-trip latency, and returns an honest capability report.
5. Save the router. The background worker polls reachability and latency on the configured interval (`pollIntervalSec`).

---

## Running Scans & Managing Devices

### 1. Triggering an On-Demand Discovery Scan
1. In the dashboard, navigate to **Networks** (`/networks`).
2. Verify your collector (`den-collector`) is listed as **CONNECTED**.
3. Click **Start scan**.
4. The web app enqueues the scan (`DISPATCHED`). On its next heartbeat, the collector sweeps the subnet (`192.168.1.0/24`) and streams progress events back to the UI.

### 2. Viewing Discovered Devices
1. Navigate to **Devices** (`/devices`).
2. Each discovered host is listed with:
   * **IP Address** & IP history
   * **MAC Address** & OUI Vendor (e.g. Apple, Genexis, Samsung)
   * **Status**: `ONLINE` (green)
   * **Latency**: Round-trip ping time in milliseconds
   * **Randomized MAC flag**: Identifies privacy MAC addresses generated by iOS/Android
3. Click any device to edit its custom friendly name, assign notes, or view historic reachability transitions.

---

## Troubleshooting & Gotchas Encountered

During real-world setup, here are the specific errors encountered and their verified fixes:

### 1. Prisma Enum Validation Error
* **Error**: `Error: Prisma schema validation - (get-config) enum UserRole { ADMIN VIEWER }`
* **Cause**: Prisma 5 requires each enum value on a new line. Single-line enums fail validation.
* **Fix**: Format all enums across multiple lines in `apps/web/prisma/schema.prisma`:
  ```prisma
  enum UserRole {
    ADMIN
    VIEWER
  }
  ```

### 2. Can't Reach Database Server at `postgres:5432`
* **Error**: `P1001: Can't reach database server at postgres:5432`
* **Cause**: `postgres` is an internal Docker bridge hostname. When running `prisma migrate` from the host terminal (macOS/Linux), the host cannot resolve `postgres`.
* **Fix**: Export localhost database URL in your shell before running Prisma commands:
  ```bash
  export DATABASE_URL="postgresql://netmon:<PASSWORD>@localhost:5432/netmon?schema=public"
  pnpm --filter web exec prisma migrate dev
  ```

### 3. Worker and Realtime Containers Crashing / Restarting
* **Error**: `Cannot find module ... esbuild.darwin-arm64.node` inside the Linux container.
* **Cause**: `docker build` copied the macOS host's `node_modules` into the Linux Alpine container via `COPY . .`.
* **Fix**: 
  1. Add `.dockerignore` at the project root containing:
     ```text
     node_modules
     .next
     dist
     .env
     ```
  2. Rebuild the images cleanly:
     ```bash
     docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache worker realtime
     docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d worker realtime
     ```

### 4. `create-collector.ts` CommonJS Syntax Error
* **Error**: `Top-level await is currently not supported with the "cjs" output format`
* **Cause**: `apps/web` compiles in CommonJS mode.
* **Fix**: Wrap logic in an `async function main() { ... }` in `apps/web/prisma/create-collector.ts`.

### 5. Scan Stuck in "QUEUED" / Button Disabled
* **Cause**: ScanJob was created with status `QUEUED` while the worker was starting.
* **Fix**: Ensure `ScanJob` is created with status `DISPATCHED` in `apps/web/src/app/api/v1/networks/[id]/discover/route.ts`. To cancel stuck scans directly:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c "UPDATE \"ScanJob\" SET status = 'CANCELLED', errors = '[\"Cleared stuck scan\"]', \"finishedAt\" = NOW() WHERE status IN ('QUEUED', 'DISPATCHED', 'RUNNING');"
  ```

### 6. Devices Discovered but Not Listed on `/devices`
* **Cause**: `ENABLE_ARP=false` was configured on the collector. The platform enforces MAC-first device resolution to avoid creating duplicate IP records. Anonymous ping sweeps without MACs are dropped by the ingestion policy.
* **Fix**:
  1. Set `ENABLE_ARP=true` in `.env.collector`.
  2. Ensure the collector supports macOS `arp -an` or Linux `ip neigh` so MAC addresses are parsed from the OS neighbour cache after ICMP pings.

### 7. macOS Ping Timeout Discrepancy
* **Issue**: macOS `ping -W <ms>` takes milliseconds; Linux `ping -W <sec>` takes seconds. A timeout of `1` on macOS results in 1ms timeout, failing all pings.
* **Fix**: In `services/collector/src/discovery/icmp.ts`:
  ```typescript
  const isMac = process.platform === "darwin";
  const w = isMac ? timeoutMs : Math.max(1, Math.ceil(timeoutMs / 1000));
  ```

### 8. Header Says "Session expired — sign in again" / Dashboard Not Updating Live
* **Cause**: before Phase 4 the browser connected straight to `http://localhost:4001` and the live connection was opened on the sign-in page, so the gateway never saw your login cookie.
* **Fix (included in Phase 4)**: the browser now connects to `/socket.io` on `http://localhost:3000` and only after you sign in. Remove `NEXT_PUBLIC_REALTIME_URL` from `.env` and `apps/web/.env`, restart `pnpm dev`, then sign out and back in.

### 9. Settings Shows "No primary collector — monitoring paused"
* Monitoring rounds go only to the network's **primary** collector, and only while it is connected. On **Networks**, edit the network and tick *Primary* for your collector. Check the collector terminal shows `monitor round completed` lines.

### 10. All Devices Show 100% Packet Loss on macOS
* Non-root `ping` on macOS can't send faster than once per second. The collector already uses 1 second on macOS (`PROBE_INTERVAL`). If you set `PROBE_INTERVAL` lower, remove it from `.env.collector`.

### 11. `service "redis" has neither an image nor a build context specified: invalid compose project`
* **Cause**: `docker-compose.dev.yml` was run on its own. It is an *override* file that only adds localhost port mappings — the images, environment variables and volumes are defined in `docker-compose.yml`. With only the dev file, Compose sees `redis`, `postgres` and `realtime` with no image and refuses to build the project.
* **Fix**: always pass both files, base first:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
  docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c 'select id, email from "User";'
  ```
  If it then says the container is not running, start the data services first:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
  ```
  `./scripts/setup.sh dev` already passes both files, so use it instead of typing the flags.

---

## Useful Commands & Operations Cheatsheet

### Docker Container Control
```bash
# View container status
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps

# Follow container logs
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f worker realtime

# Restart specific containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart worker realtime

# Stop development containers (preserves database volumes)
./scripts/setup.sh down

# Wipe all containers and database data (complete clean slate)
./scripts/setup.sh reset
```

### PostgreSQL Inspection inside Docker
```bash
# Open interactive psql shell
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon

# Quick query: list discovered devices
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c "SELECT id, hostname, status, \"lastSeenAt\" FROM \"Device\";"

# Quick query: check scan job statuses
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c "SELECT id, status, \"hostsScanned\", \"devicesFound\" FROM \"ScanJob\" ORDER BY \"createdAt\" DESC LIMIT 5;"

# Quick query: check which users exist (stale sign-in / audit-log errors)
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c 'select id, email from "User";'
```

### Running the Collector
```bash
# Start collector with environment variables loaded
export $(grep -v '^#' .env.collector | xargs) && pnpm --filter @netmon/collector dev
```

---

## Production Deployment (Docker)

To run the entire stack (including the Next.js web application and Nginx reverse proxy) inside Docker containers:

```bash
# Run production setup
./scripts/setup.sh prod
```

This starts:
* `web` container (Next.js production build)
* `worker` container (BullMQ scheduler)
* `realtime` container (WebSocket gateway)
* `postgres` container
* `redis` container
* `nginx` container (terminating HTTP on port `3000`)

Access the production dashboard at **`http://localhost:3000`**.

---

## Upgrading an Existing Phase 3 Install to Phase 4

Run these from the project root on your Mac, with your existing data kept.

```bash
# 1. Copy the Phase 4 files over your project (keep your .env, .env.collector and apps/web/.env).

# 2. Remove the old direct gateway address (live updates now go through the web app)
sed -i '' '/^NEXT_PUBLIC_REALTIME_URL=/d' .env apps/web/.env
echo 'REALTIME_INTERNAL_URL=http://localhost:4001' >> apps/web/.env

# 3. Install and add the new tables (creates a new migration; existing data is kept)
pnpm install
pnpm --filter web exec prisma migrate dev --name phase4_monitoring
pnpm --filter web exec prisma generate

# 4. Rebuild the worker and realtime containers (new monitoring engine, gateway path)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build worker realtime

# 5. Restart the web app (Ctrl+C the old one first)
pnpm dev

# 6. Restart the collector (new version 0.4.0 runs the latency probes)
export $(grep -v '^#' .env.collector | xargs) && pnpm --filter @netmon/collector dev
```

Then sign out and sign back in. Within about a minute:
* the header shows a green **Live**;
* the collector terminal prints `monitor round completed`;
* **Overview** shows average latency and packet loss;
* after the first 5 minutes, the health score and charts get their first points.

> Charts start empty and fill in as history is recorded. A single dot is normal for the first hour.

---

## Phase 4: Monitoring Engine Reference

### How a monitoring round works
```text
worker (every 15s tick)
  └─ for each network with a CONNECTED primary collector, once per interval:
       create MonitorTask (unique key network:interval:bucket → no duplicates, even after restarts)
collector heartbeat (every 20s)
  └─ receives PENDING tasks → pings each target N times → POST /collectors/ingest/latency (once)
web app
  └─ stores LatencyMeasurement rows → queues "evaluate" job (unique per task)
worker
  └─ status machine (offline after N consecutive failed rounds), transitions, events → Redis → Socket.IO
worker (every 5 min)
  └─ hourly rollups, health snapshots, retention clean-up
```
Rounds the collector never answers expire after 2× the interval (minimum 2 minutes) and are listed under **Settings → Recent job failures**. Devices flagged as blocking ping are never marked offline by ping loss alone.

### Settings you can change
| Where | Setting | Default |
|---|---|---|
| Settings page, per network | Interval between rounds | 60 s (15–3600) |
| Settings page, per network | Pings per target | 4 (1–10) |
| Settings page, per network | Offline after N failed rounds | 3 |
| Router page | Router poll interval | 60 s |
| Worker env | `MONITOR_TICK_MS` | 15000 |
| Worker env | `AGGREGATE_EVERY_MS` (rollups + health snapshot) | 300000 |
| Worker env | `MONITOR_PING_TIMEOUT_MS` | 1000 |
| Worker env | `COLLECTOR_TIMEOUT_MS` (collector marked disconnected) | 90000 |
| Worker env | `RAW_METRIC_RETENTION_DAYS` | 7 |
| Worker env | `ROLLUP_RETENTION_DAYS` | 90 |
| `.env.collector` | `MONITOR_CONCURRENCY` | 32 |
| `.env.collector` | `PROBE_INTERVAL` (seconds between echoes) | 0.2 Linux, 1 macOS |

### Health score
0–100, weighted over the parts that have data: device availability 40% (unknown devices excluded), router availability 20%, collector availability 20%, (1 − packet loss) 20%. Shown as "—" until there is data.

### Useful checks
```bash
# Monitoring rounds by status
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c 'SELECT status, count(*) FROM "MonitorTask" GROUP BY 1;'
# Latest measurements
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c 'SELECT host("targetIp"), "avgMs", "packetLoss", "measuredAt" FROM "LatencyMeasurement" ORDER BY "measuredAt" DESC LIMIT 10;'
# Job failures
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c 'SELECT queue, "jobName", error, "failedAt" FROM "JobFailure" ORDER BY "failedAt" DESC LIMIT 10;'
# Worker log lines for monitoring
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f worker | grep -i monitor
```

### New API endpoints
* `GET /api/v1/dashboard` · `GET /api/v1/dashboard/charts?range=24h|7d|30d`
* `GET /api/v1/devices/:id/metrics?range=…` · `GET /api/v1/devices/:id/history`
* `GET /api/v1/events?category&severity&deviceId&routerId&networkId&collectorId&from&to&q&page&pageSize`
* `GET /api/v1/events/export?…same filters…` (CSV, up to 50,000 rows)
* `GET /api/v1/monitoring` · `PATCH /api/v1/networks/:id/monitoring` (admin)
* Collector: `POST /api/v1/collectors/ingest/latency`; heartbeat now also returns `monitors`.


---

## Upgrading a Phase 4 Install to Phase 5

Run from the project root on your Mac. Your data is kept.

```bash
# 1. Copy the Phase 5 files over your project (keep .env, .env.collector and apps/web/.env).

# 2. Install, add the new tables and regenerate the client
pnpm install
pnpm --filter web exec prisma migrate dev --name phase5_topology_traffic
pnpm --filter web exec prisma generate

# 3. Rebuild the worker (traffic rollups + SNMP traffic) and realtime (new live events)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build worker realtime

# 4. Restart the web app (Ctrl+C the old one first)
pnpm dev

# 5. Restart the collector (version 0.5.0)
export $(grep -v '^#' .env.collector | xargs) && pnpm --filter @netmon/collector dev
```

Then open **Network Topology** and **Traffic Analytics**.

### What you will see on a typical home setup (ISP ONT + D-Link R15)
* **Topology** draws immediately from what is already recorded: both routers, both LANs, the collector and every device.
  * If the R15's WAN IP lies inside the ISP LAN, the R15 is linked under the ISP LAN with an **Inferred** (dotted, amber) link.
    To make it **Configured**, add a router↔network link with role `UPSTREAM` (see the SQL in the reference below).
  * The **Internet** node appears only when a router reports a WAN IP or WAN state.
* **Traffic** will most likely say **Unavailable** at first. That is correct:
  * The Genexis ONT on HTTP_PROBE and the R15 on D-Link HNAP do not report byte counters.
  * ARP/ICMP discovery never measures bandwidth.
  * To get real numbers, use one of the sources below.

---

## Phase 5: Topology & Traffic Reference

### Traffic sources (what is real, what is not)

| Source | Gives | Status in this version | How to enable |
|---|---|---|---|
| SNMP interface counters | Per-interface bytes / rate / utilisation | Implemented (worker, every router poll) | Router integration `SNMP_V2C` or `SNMP_V3` |
| Router client statistics | Per-device bytes | Implemented *if* a router adapter returns per-client counters. D-Link HNAP and standard SNMP don't, so it shows **unsupported** | — |
| NetFlow v5 | Per-device bytes / rate | Implemented (collector UDP receiver) | `ENABLE_NETFLOW=true` in `.env.collector` + router/switch exports to the collector |
| IPFIX / NetFlow v9 | — | Detected and reported as not decoded | Configure the exporter for v5 |
| sFlow | — | Not implemented | — |
| Packet capture | — | Disabled. Packet contents are never captured | — |

Rules the code enforces:
* Totals come **only** from interfaces with role `WAN`. LAN interfaces are shown for utilisation only (no double counting).
* Router aggregate traffic is **never** split across devices.
* A NetFlow host is attributed to a device only if its IP is that device's *current* address in one of the collector's networks. Others are counted as `unmatched` and dropped (no external IPs are stored).
* A counter reset (router reboot) or an impossible jump produces **no sample**, not a zero.
* Only header counters are stored. No payloads, no individual flow records.

### Enabling NetFlow v5
```bash
# .env.collector
ENABLE_NETFLOW=true
NETFLOW_PORT=2055
NETFLOW_EXPORTERS=192.168.0.1     # optional: only accept from these exporter IPs
NETFLOW_FLUSH_SEC=60
```
Point the router/switch NetFlow **v5** export at the collector host's IP, UDP port 2055. Restart the collector; it logs `netflow v5 listener started` and, every minute, `netflow window uploaded {stored, unmatched}`.
On macOS, allow incoming connections for `node` when the firewall asks. In Docker the collector uses host networking, so the port is open on the host.

### WAN / LAN interface roles
Roles are guessed from interface names (`wan`, `ppp`, `pon` → WAN; `br-lan`, `eth`, `wlan` → LAN; anything else → OTHER).
Fix a wrong guess under **Routers → (router) → Interfaces → Role**. New samples use the new role.

### Mark the R15 uplink as configured (optional)
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c \
"INSERT INTO \"RouterNetwork\"(\"routerId\",\"networkId\",role) SELECT r.id, n.id, 'UPSTREAM' FROM \"Router\" r, \"Network\" n WHERE r.name='D-Link R15' AND n.name='ISP LAN' ON CONFLICT DO NOTHING;"
```
(Use your own router and network names.)

### Worker settings (env)
| Variable | Default | Meaning |
|---|---|---|
| `TRAFFIC_AGGREGATE_EVERY_MS` | 300000 | Hourly rollups + staleness check interval |
| `TRAFFIC_RAW_RETENTION_DAYS` | 7 | Raw traffic samples kept |
| `TRAFFIC_ROLLUP_RETENTION_DAYS` | 90 | Hourly rollups kept |
| `TRAFFIC_STALE_MS` | 900000 | A source with no samples for this long is marked STALE |

Short ranges (1h / 6h / 24h) read raw samples; 7d / 30d read hourly rollups.

### Useful checks
```bash
# Traffic sources and their state
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c \
'select kind, name, status, detail, "lastSampleAt" from "TrafficSource";'
# Latest samples
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres psql -U netmon -d netmon -c \
'select scope, "downloadBps", "uploadBps", "measuredAt" from "TrafficSample" order by "measuredAt" desc limit 10;'
# Tests (counters + NetFlow decoder)
pnpm --filter @netmon/network-core test
pnpm --filter @netmon/collector test
```

### New API endpoints
* `GET /api/v1/topology?networkId&category&showOffline` · `PUT/DELETE /api/v1/topology/layout`
* `GET /api/v1/traffic?range=1h|6h|24h|7d|30d&networkId` · `GET /api/v1/traffic/sources`
* `GET /api/v1/devices/:id/traffic?range=…`
* `PATCH /api/v1/routers/:id/interfaces/:interfaceId` `{ role: "WAN"|"LAN"|"OTHER" }` (admin)
* Collector: `POST /api/v1/collectors/ingest/traffic`
* Realtime events: `traffic:updated`, `topology:updated`

### Phase 5 fix included
* SNMP walks now have a hard deadline. Some agents never finish walking an empty table, which used to hang the whole router poll.


---

## Phase 6 Reference

### Upgrading an existing Phase 5 install

```bash
# 0. Back up first (the database keeps running)
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres \
  pg_dump -U netmon -Fc netmon > before-phase6.dump

# 1. Copy the Phase 6 files over your project. Keep .env, .env.collector, apps/web/.env and apps/web/prisma/migrations/.
# 2. Add the new settings from .env.example (the "Phase 6" block) to .env and apps/web/.env.
# 3. Install and create the Phase 6 migration (additive: new tables/columns only, nothing dropped)
pnpm install
pnpm --filter web exec prisma migrate dev --name phase6_security_alerting
# 4. Rebuild worker and realtime (new alert, notification and maintenance jobs)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build worker realtime
# 5. Restart the web app, then sign in again (old sessions are not valid after the upgrade)
pnpm dev
```

`docs/phase6-upgrade.sql` contains the exact SQL Prisma generates for this step, for review. Alert rules that existed before Phase 6 have no condition type and are never evaluated; delete or recreate them on the Alerts → Rules tab.

### Architecture (Phase 6 additions)

```text
browser ──https──> nginx ──> web (Next.js)  ── Postgres
                     │          │  REST + session checks against the DB on every request
                     └─ /socket.io ─> realtime ── Redis pub/sub <── worker
collector ──bearer token──> web /api/v1/collectors/*          │
                                                              ├─ alert-evaluate (every 30 s; each rule on its own interval)
                                                              ├─ notify-deliver (email; retries with exponential backoff)
                                                              └─ maintenance (heartbeat 30 s, retention every 6 h)
backup service ── pg_dump every N hours ──> ./backups (verified + sha256, rotated)
```

### Security

| Area | What happens |
|------|--------------|
| Sessions | Encrypted cookie, HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=true`. Checked against the database on every request: deleted/disabled users, role changes and **Settings → Sign out everywhere** apply immediately. Absolute limit `SESSION_MAX_AGE_HOURS` (12), idle limit `SESSION_IDLE_MINUTES` (120). |
| Roles | ADMIN can change things; VIEWER is read-only. Every write route requires ADMIN on the server; buttons are also hidden for viewers. |
| Login | 5 attempts/minute per IP and 10 per 15 minutes per account; identical error for wrong email or password; failures audited. |
| Cross-site requests | Browser writes from another origin are rejected (403 `FORBIDDEN_ORIGIN`). Add extra origins in `APP_ORIGIN` only if you really serve the UI from another address. |
| Headers | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS (HTTPS config); `X-Powered-By` removed; API responses `no-store`. |
| Errors | Clients get a code and a generic message; details go to server logs. Database outages return 503 `DATABASE_UNAVAILABLE`. |
| Collectors | 256-bit tokens, only SHA-256 stored. **Collectors → Rotate** issues a new token (shown once; old one stops working at once). **Revoke** blocks the collector and cancels its scans. A collector can only submit data for networks it is assigned to and only for its own scans/monitoring rounds. Rate limited per collector (`COLLECTOR_RATE_LIMIT_PER_MIN`). |
| Router credentials | AES-256-GCM with `ROUTER_CREDENTIALS_KEY`; never returned by any API (only `hasCredentials`); worker logs pass through a redactor that masks token/password/secret/authorization fields and bearer headers. |
| Realtime | Socket handshake needs a valid, unexpired session cookie; sockets are dropped when the session reaches its maximum age. CORS is off unless `APP_ORIGIN` is set. All signed-in users of an installation see all networks (there are no per-user network permissions in this product). |
| Docker | Only nginx publishes ports (`HTTP_BIND`/`HTTP_PORT`/`HTTPS_PORT`). Postgres and Redis are on the private `internal` network. Web, worker and realtime run as non-root users; the collector drops all capabilities except `NET_RAW` and sets `no-new-privileges`. |

Recommendations: use HTTPS for anything beyond your own LAN, set `HTTP_BIND=127.0.0.1` if you only use it from the server itself, keep `.env` at `chmod 600`, rotate collector tokens if a machine is lost, and store backups on a different disk.

### Alerts

**Alerts → Rules → New rule.** Every rule has a condition, optional network scope, threshold, look-back window, evaluation interval, cooldown, severity and an email on/off switch.

| Condition | Threshold means | Data used |
|-----------|-----------------|-----------|
| Device offline | minutes offline before alerting | device status from consecutive failed monitoring rounds |
| Device back online | — (fires once per recovery) | status transitions |
| Router or modem offline | minutes unreachable | router polling |
| Collector disconnected | minutes without heartbeat | collector heartbeats |
| High latency | average ms over the window | latency measurements |
| High packet loss | fraction 0–1 (0.2 = 20 %) | latency measurements; devices that block ping are skipped |
| Unusual bandwidth | average bits/s over the window | per-device traffic only (router client stats / NetFlow) |
| Network unavailable | — | no device online, or all of the network's collectors disconnected |
| Monitoring service failure | failed jobs allowed in the window | final job failures, or a worker that stopped reporting |

Lifecycle: **open → acknowledged → resolved**. One open alert per rule and target (no duplicates); it resolves automatically when the condition clears, is kept in **History**, and shows severity, timestamps, network and device. If there is no data (for example no traffic source), a rule neither fires nor resolves — "no data" is never treated as healthy or broken.

**Notifications.** In-app notifications appear under the bell in the header. For email, set in `.env` and restart the worker:
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false        # true for port 465
SMTP_USER=you@gmail.com
SMTP_PASSWORD=<app password>
SMTP_FROM="NetWatch <you@gmail.com>"
```
Then **Settings → Notifications → Add email channel** and press **Send test** — the page shows whether the message was actually accepted by the mail server. Emails are sent by the worker in the background with up to `NOTIFY_ATTEMPTS` retries, so a slow mail server never delays monitoring. The cooldown stops repeat emails for a still-open alert. Telegram, Discord and webhooks are not implemented yet (the channel types exist so they can be added without changing rules).

### Monitoring reliability

- Collector heartbeat timeout → `DISCONNECTED` (`COLLECTOR_TIMEOUT_MS`, 90 s); reconnects are logged as events.
- A scan request is saved before it is queued; if Redis or the worker is down it is dispatched when they come back (the collector also receives queued scans on its heartbeat). Only one scan per network can be active, even with simultaneous clicks. **Cancel scan:** `DELETE /api/v1/networks/<id>/discover` (admin); late updates from the collector for a cancelled scan are ignored.
- On worker start: stale queued scans are failed with a reason, recent ones re-queued, unsent notifications re-queued. All recurring jobs use keyed schedulers (no duplicates after restarts or with two workers), have timeouts, and failures are kept in the Job Failures list.
- Devices go offline only after `offlineThreshold` consecutive failed rounds (Settings); devices flagged as blocking ping are not marked offline by ping loss.

### Data retention

Set in `.env` (days, `0` = keep forever — the default for everything that was not already limited). Applied by the worker every 6 hours. Devices, networks, routers and collectors are never deleted by retention.

`OBSERVATION_RETENTION_DAYS`, `DEVICE_METRIC_RETENTION_DAYS`, `ROUTER_METRIC_RETENTION_DAYS`, `INTERFACE_METRIC_RETENTION_DAYS` (2), `TRAFFIC_FLOW_RETENTION_DAYS`, `EVENT_RETENTION_DAYS`, `RESOLVED_ALERT_RETENTION_DAYS`, `NOTIFICATION_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`, `JOB_FAILURE_RETENTION_DAYS` (30). Existing Phase 4/5 limits (`RAW_METRIC_RETENTION_DAYS`, `ROLLUP_RETENTION_DAYS`, `TRAFFIC_*_RETENTION_DAYS`) still apply.

### Backups and restore

The `backup` service runs `pg_dump` every `BACKUP_INTERVAL_HOURS` (24) into `BACKUP_PATH` (`./backups`), keeps the newest `BACKUP_KEEP` (14), checks each archive (`pg_restore --list` + required tables), writes a `.sha256` next to it, and records the result on **System Health**.

```bash
./scripts/netmon.sh backup                 # run one now
./scripts/netmon.sh backups                # list
./scripts/netmon.sh restore netmon-20261113T103132Z.dump
```
Restore checks the checksum and archive, takes a safety backup of the current database, stops web and worker, restores, starts them and applies migrations. Copy `./backups` to another disk regularly. Dev setup (no backup container): `docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps backup /bin/sh /scripts/backup.sh` uses the same script.

### Production deployment

```bash
cp .env.example .env            # or: ./scripts/netmon.sh install  (generates secrets)
./scripts/netmon.sh install     # build, start, migrate, seed, health check
./scripts/netmon.sh start | stop | restart [service] | status
./scripts/netmon.sh update      # backup -> git pull (if a git checkout) -> rebuild -> migrate -> health
./scripts/netmon.sh migrate
./scripts/netmon.sh logs [service]
./scripts/netmon.sh health
```
None of these delete volumes. The only command that deletes data is the explicit `./scripts/setup.sh reset` (asks first). Services restart automatically (`unless-stopped`), start in dependency order after health checks, have memory limits and rotated logs. Redis now persists to disk (`redisdata` volume) so queued jobs survive restarts. The production stack needs migration files in `apps/web/prisma/migrations` (created by `migrate dev` on your dev machine).

### HTTPS

1. Get a certificate for your host name.
   - Public domain: `docker run --rm -p 80:80 -v $PWD/docker/nginx/certs:/etc/letsencrypt certbot/certbot certonly --standalone -d monitor.example.com` (stop nginx first), then copy `live/monitor.example.com/fullchain.pem` and `privkey.pem` into `docker/nginx/certs/`.
   - LAN only: `mkcert monitor.lan 192.168.0.10` (install mkcert's root CA on your devices) or a self-signed pair: `openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout docker/nginx/certs/privkey.pem -out docker/nginx/certs/fullchain.pem -subj "/CN=monitor.lan"`.
2. In `.env`: `NGINX_CONF=./docker/nginx/https.conf`, `COOKIE_SECURE=true`, `HTTP_PORT=80`, `HTTPS_PORT=443`.
3. `./scripts/netmon.sh restart nginx` (or `start`). HTTP redirects to HTTPS; WebSockets work over `wss://`.
4. Renewal (Let's Encrypt, every 60–90 days): rerun the certbot command, copy the files, `docker compose exec nginx nginx -s reload`. A cron entry such as `0 3 1 * * cd /opt/netmon && ./renew.sh` keeps it automatic.

Tested here: the configuration and HTTP path. A real certificate on a public domain was not tested (needs your domain).

### System Health page

Sidebar → **System Health**: web, PostgreSQL (response time, version, size, largest tables), Redis (response time, memory), worker (heartbeat age), realtime gateway (response, connected browsers), each collector, job queue counts (active/waiting/delayed/failed), recent job failures, last verified backup and backup scheduler, and the application version. Everything is measured when the page loads; missing information shows as "unknown" or "has not reported in" with a hint, never a guessed value.

### Tests and quality checks

```bash
pnpm test                       # unit tests: alert rules, session/role policy, status transitions, redaction, counters, NetFlow
pnpm lint                       # ESLint
pnpm typecheck                  # tsc for every package
pnpm --filter web exec prisma validate
NODE_ENV=production pnpm --filter web build

# API integration tests against a running TEST stack (creates and removes its own it-* records):
node apps/web/tests/smtp-sink.mjs 2525 /tmp/mail.txt &      # optional local mail catcher
# worker started with SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_FROM=test@local ALERT_TICK_MS=5000
BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm test:integration
```
The integration suite covers login/logout/sign-out-everywhere, disabled users, live role changes, viewer write blocking, cross-site rejection, headers, validation, mass assignment, router-credential redaction, collector auth/registration/heartbeat/ingest, network assignment, token rotation and revocation, concurrent scan requests, alert rule CRUD, device-offline alert → in-app + email → acknowledge → auto-resolve, latency alerts from real measurements, channel test email, system health and login rate limiting.

### New environment variables

`APP_VERSION`, `APP_ORIGIN`, `SESSION_MAX_AGE_HOURS`, `SESSION_IDLE_MINUTES`, `COOKIE_SECURE`, `COLLECTOR_RATE_LIMIT_PER_MIN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `NOTIFY_ATTEMPTS`, `ALERT_TICK_MS`, the retention variables above, `RETENTION_EVERY_MS`, `SCAN_RECOVERY_GRACE_MS`, `BACKUP_PATH`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP`, `HTTP_BIND`, `HTTP_PORT`, `HTTPS_PORT`, `NGINX_CONF`.

### Known limitations

- No per-user network permissions: every signed-in user sees every network (ADMIN vs VIEWER controls changes only).
- Email is the only external channel; Telegram/Discord/webhook are not implemented.
- Bandwidth alerts need per-device traffic (router client byte counters or NetFlow). The Genexis ONT and D-Link R15 do not provide this, so at home this rule will usually have no data.
- The collector does not stop a scan that is already running when it is cancelled; it finishes and its result is ignored.
- Rate limits are simple per-minute counters in Redis; if Redis is down, login is refused rather than unlimited.
- Docker images, a public Let's Encrypt certificate and real-router behaviour were not exercised in the test environment.
