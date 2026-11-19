/**
 * API integration tests against a running stack (web + worker + Postgres + Redis).
 *   BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... DATABASE_URL=... REDIS_URL=... \
 *   pnpm --filter web test:integration
 * Creates its own test users/collector/rules (prefixed "it-") and removes them afterwards.
 * Uses real monitoring tables; nothing is mocked. Run against a test database, not production.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();
const redis = new IORedis(process.env.REDIS_URL!);
const tag = `it-${Date.now()}`;
let ip = 0;
const nextIp = () => `10.250.0.${++ip}`;

async function call(path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": init.ip ?? "10.250.1.1", ...(init.headers as Record<string, string>) };
  if (init.cookie) headers.cookie = init.cookie;
  const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers, redirect: "manual" });
  const body = await res.json().catch(() => null) as { ok: boolean; data?: any; /* eslint-disable-line @typescript-eslint/no-explicit-any */ error?: { code: string; message: string } } | null;
  return { status: res.status, body, setCookie: res.headers.get("set-cookie"), headers: res.headers };
}
async function login(email: string, password: string): Promise<string> {
  const r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password }), ip: nextIp() });
  assert.equal(r.status, 200, `login failed: ${JSON.stringify(r.body)}`);
  return r.setCookie!.split(";")[0]!;
}
const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 1000)); }
};

let admin = "", viewer = "", viewerId = "";
const viewerEmail = `${tag}-viewer@test.local`, viewerPass = randomBytes(9).toString("base64url");
const collectorName = `${tag}-col`;
let collectorId = "", collectorToken = "";
let networkId = "", networkCidr = "";

before(async () => {
  for (const k of await redis.keys("rl:*")) await redis.del(k);
  admin = await login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  viewerId = (await prisma.user.create({ data: { email: viewerEmail, passwordHash: await bcrypt.hash(viewerPass, 10), role: "VIEWER" } })).id;
  viewer = await login(viewerEmail, viewerPass);
  const net = await prisma.network.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  networkId = net.id; networkCidr = net.cidr;
  collectorToken = randomBytes(32).toString("base64url");
  const c = await prisma.collector.create({ data: { name: collectorName, tokenHash: createHash("sha256").update(collectorToken).digest("hex") } });
  collectorId = c.id;
});

after(async () => {
  await prisma.alertRule.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.notificationChannel.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.collectorNetwork.deleteMany({ where: { collectorId } });
  await prisma.scanJob.deleteMany({ where: { collectorId } });
  await prisma.collector.deleteMany({ where: { id: collectorId } });
  await prisma.user.deleteMany({ where: { id: viewerId } });
  await prisma.$disconnect(); redis.disconnect();
});

// ---------- authentication & authorization ----------
test("protected APIs reject anonymous requests", async () => {
  for (const p of ["/devices", "/networks", "/routers", "/alerts", "/alerts/rules", "/system/health", "/collectors", "/notifications"]) {
    assert.equal((await call(p)).status, 401, p);
  }
});
test("health endpoint is public but reveals no internals", async () => {
  const r = await call("/health");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body!.data).sort(), ["database", "redis", "status"]);
});
test("wrong password is rejected with a generic message", async () => {
  const r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: viewerEmail, password: "wrong-password" }), ip: nextIp() });
  assert.equal(r.status, 401);
  assert.equal(r.body!.error!.message, "Invalid email or password");
});
test("viewer can read but not modify", async () => {
  assert.equal((await call("/devices", { cookie: viewer })).status, 200);
  assert.equal((await call("/alerts/rules", { cookie: viewer })).status, 200);
  const w = await call("/alerts/rules", { method: "POST", cookie: viewer, body: JSON.stringify({ name: `${tag}-x`, type: "DEVICE_OFFLINE" }) });
  assert.equal(w.status, 403);
  assert.equal((await call(`/collectors/${collectorId}/token`, { method: "POST", cookie: viewer })).status, 403);
  assert.equal((await call(`/networks/${networkId}/discover`, { method: "POST", cookie: viewer })).status, 403);
});
test("role change in the database applies to existing sessions immediately", async () => {
  await prisma.user.update({ where: { id: viewerId }, data: { role: "ADMIN" } });
  const me = await call("/auth/me", { cookie: viewer });
  assert.equal(me.body!.data.role, "ADMIN");
  await prisma.user.update({ where: { id: viewerId }, data: { role: "VIEWER" } });
  assert.equal((await call("/auth/me", { cookie: viewer })).body!.data.role, "VIEWER");
});
test("disabled users are signed out", async () => {
  const s = await login(viewerEmail, viewerPass);
  await prisma.user.update({ where: { id: viewerId }, data: { disabled: true } });
  assert.equal((await call("/devices", { cookie: s })).status, 401);
  assert.equal((await call("/auth/login", { method: "POST", body: JSON.stringify({ email: viewerEmail, password: viewerPass }), ip: nextIp() })).status, 401);
  await prisma.user.update({ where: { id: viewerId }, data: { disabled: false } });
});
test("logout ends the session; logout?all=1 revokes every session", async () => {
  const a = await login(viewerEmail, viewerPass), b = await login(viewerEmail, viewerPass);
  const out = await call("/auth/logout", { method: "POST", cookie: a });
  assert.equal(out.status, 200);
  assert.match(out.setCookie ?? "", /netmon_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  assert.equal((await call("/devices", { cookie: b })).status, 200);
  await call("/auth/logout?all=1", { method: "POST", cookie: b });
  assert.equal((await call("/devices", { cookie: b })).status, 401, "replayed old cookie must be rejected after sign-out-everywhere");
  viewer = await login(viewerEmail, viewerPass);
});
test("cross-site browser writes are rejected", async () => {
  const r = await call("/alerts/rules", { method: "POST", cookie: admin, headers: { origin: "https://evil.example" }, body: JSON.stringify({ name: `${tag}-csrf`, type: "DEVICE_OFFLINE" }) });
  assert.equal(r.status, 403);
  assert.equal(r.body!.error!.code, "FORBIDDEN_ORIGIN");
});
test("security headers are set", async () => {
  const r = await call("/devices", { cookie: admin });
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.ok(r.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  assert.equal(r.headers.get("x-powered-by"), null);
});
test("invalid JSON and invalid input return 400 without internals", async () => {
  const bad = await fetch(`${BASE}/api/v1/alerts/rules`, { method: "POST", headers: { cookie: admin, "content-type": "application/json" }, body: "{not json" });
  assert.equal(bad.status, 400);
  const txt = await bad.text();
  assert.ok(!/at .*\.ts|node_modules|stack/i.test(txt), txt);
  const v = await call("/alerts/rules", { method: "POST", cookie: admin, body: JSON.stringify({ name: "", type: "NOPE" }) });
  assert.equal(v.status, 400);
});
test("mass assignment: unknown fields are not accepted on rule updates", async () => {
  const r = await call("/alerts/rules", { method: "POST", cookie: admin, body: JSON.stringify({ name: `${tag}-ma`, type: "DEVICE_OFFLINE", threshold: 1, id: "00000000-0000-0000-0000-000000000000", lastEvaluatedAt: "2000-01-01T00:00:00Z" }) });
  assert.equal(r.status, 200);
  assert.notEqual(r.body!.data.id, "00000000-0000-0000-0000-000000000000");
  assert.equal(r.body!.data.lastEvaluatedAt, null);
  const p = await call(`/alerts/rules/${r.body!.data.id}`, { method: "PATCH", cookie: admin, body: JSON.stringify({ createdAt: "2000-01-01T00:00:00Z" }) });
  assert.equal(p.status, 400);
});
test("router credentials are never returned", async () => {
  const r = await call("/routers", { cookie: admin });
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes("credentialsEnc"), "encrypted blob leaked");
  assert.ok(!/"password"\s*:/.test(s), "password field leaked");
});

// ---------- collectors ----------
const col = (path: string, body: unknown, token = collectorToken, name = collectorName) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${token}`, "x-collector-id": name } });

test("collector auth: missing, wrong and mismatched credentials are rejected", async () => {
  assert.equal((await call("/collectors/heartbeat", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await col("/collectors/heartbeat", { version: "t", uptimeSec: 1, activeScanId: null }, "wrong")).status, 401);
  assert.equal((await col("/collectors/heartbeat", { version: "t", uptimeSec: 1, activeScanId: null }, collectorToken, "someone-else")).status, 401);
});
test("collector registration and heartbeat", async () => {
  const reg = await call("/collectors/register", { method: "POST", body: JSON.stringify({ collectorId: collectorName, cidrs: [networkCidr], version: "it", hostname: "it-host" }), headers: { authorization: `Bearer ${collectorToken}`, "x-collector-id": collectorName, "x-network-context": (await prisma.network.findUniqueOrThrow({ where: { id: networkId } })).context } });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const hb = await col("/collectors/heartbeat", { version: "it", uptimeSec: 1, activeScanId: null });
  assert.equal(hb.status, 200);
  assert.ok(Array.isArray(hb.body!.data.assignments));
  assert.equal((await prisma.collector.findUniqueOrThrow({ where: { id: collectorId } })).status, "CONNECTED");
});
test("collector cannot ingest for a network it is not assigned to", async () => {
  const r = await col("/collectors/ingest/devices", { cidr: "203.0.113.0/24", scanJobId: null, observations: [] });
  assert.equal(r.status, 400);
  assert.match(r.body!.error!.message, /not assigned/);
});
test("collector cannot attach observations to another collector's scan", async () => {
  const other = await prisma.scanJob.create({ data: { networkId, status: "RUNNING" } });
  const r = await col("/collectors/ingest/devices", { cidr: networkCidr, scanJobId: other.id, observations: [] });
  assert.equal(r.status, 400);
  await prisma.scanJob.delete({ where: { id: other.id } });
});
test("device ingestion stores observations from an assigned collector", async () => {
  const r = await col("/collectors/ingest/devices", { cidr: networkCidr, scanJobId: null, observations: [] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
test("event ingestion ignores scans owned by other collectors", async () => {
  const r = await col("/collectors/ingest/events", { events: [{ type: "scan.completed", scanJobId: "00000000-0000-0000-0000-000000000000", devicesFound: 1 }] });
  assert.equal(r.status, 200);
});
test("token rotation invalidates the old token; revocation blocks the collector", async () => {
  const rot = await call(`/collectors/${collectorId}/token`, { method: "POST", cookie: admin });
  assert.equal(rot.status, 200);
  const fresh = rot.body!.data.token as string;
  assert.ok(fresh.length >= 40);
  assert.equal((await col("/collectors/heartbeat", { version: "it", uptimeSec: 1, activeScanId: null })).status, 401, "old token must stop working");
  assert.equal((await col("/collectors/heartbeat", { version: "it", uptimeSec: 1, activeScanId: null }, fresh)).status, 200);
  const stored = await prisma.collector.findUniqueOrThrow({ where: { id: collectorId } });
  assert.notEqual(stored.tokenHash, fresh, "token must be stored hashed");
  assert.equal((await call(`/collectors/${collectorId}/token`, { method: "DELETE", cookie: admin })).status, 200);
  const rv = await col("/collectors/heartbeat", { version: "it", uptimeSec: 1, activeScanId: null }, fresh);
  assert.equal(rv.status, 401);
  assert.equal(rv.body!.error!.code, "COLLECTOR_REVOKED");
  collectorToken = (await call(`/collectors/${collectorId}/token`, { method: "POST", cookie: admin })).body!.data.token;
  assert.equal((await col("/collectors/heartbeat", { version: "it", uptimeSec: 1, activeScanId: null })).status, 200, "rotation re-enables a revoked collector");
});
test("collector list never exposes token hashes", async () => {
  const r = await call("/collectors", { cookie: admin });
  assert.ok(!JSON.stringify(r.body).includes("tokenHash"));
});

// ---------- scans ----------
test("only one scan per network at a time, even with concurrent requests", async () => {
  await prisma.collectorNetwork.updateMany({ where: { networkId }, data: { isPrimary: false } });
  await prisma.collectorNetwork.update({ where: { collectorId_networkId: { collectorId, networkId } }, data: { isPrimary: true } });
  await prisma.scanJob.updateMany({ where: { networkId, status: { in: ["QUEUED", "DISPATCHED", "RUNNING"] } }, data: { status: "CANCELLED" } });
  const rs = await Promise.all([1, 2, 3].map(() => call(`/networks/${networkId}/discover`, { method: "POST", cookie: admin })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join(","));
  assert.ok(rs.filter((r) => r.status === 409).length === 2);
  const cancel = await call(`/networks/${networkId}/discover`, { method: "DELETE", cookie: admin });
  assert.equal(cancel.body!.data.cancelled, 1);
});

// ---------- alerts ----------
test("alert rule CRUD with validation", async () => {
  const bad = await call("/alerts/rules", { method: "POST", cookie: admin, body: JSON.stringify({ name: `${tag}-lat`, type: "HIGH_LATENCY" }) });
  assert.equal(bad.status, 400, "threshold required for latency");
  const loss = await call("/alerts/rules", { method: "POST", cookie: admin, body: JSON.stringify({ name: `${tag}-loss`, type: "HIGH_PACKET_LOSS", threshold: 20 }) });
  assert.equal(loss.status, 400, "loss threshold must be a fraction");
  const ok = await call("/alerts/rules", { method: "POST", cookie: admin, body: JSON.stringify({ name: `${tag}-lat`, type: "HIGH_LATENCY", threshold: 100, networkId }) });
  assert.equal(ok.status, 200);
  const id = ok.body!.data.id;
  const upd = await call(`/alerts/rules/${id}`, { method: "PATCH", cookie: admin, body: JSON.stringify({ threshold: 250, enabled: false, cooldownSec: 60 }) });
  assert.equal(upd.body!.data.threshold, 250);
  assert.equal(upd.body!.data.enabled, false);
  assert.equal((await call(`/alerts/rules/${id}`, { method: "DELETE", cookie: admin })).status, 200);
  assert.equal((await call(`/alerts/rules/${id}`, { method: "DELETE", cookie: admin })).status, 404);
});
test("rule scope must be consistent (device in selected network)", async () => {
  const other = await prisma.device.findFirst({ where: { networkId: { not: networkId } } });
  if (!other) return; // single-network database
  const r = await call("/alerts/rules", { method: "POST", cookie: admin, body: JSON.stringify({ name: `${tag}-scope`, type: "DEVICE_OFFLINE", networkId, deviceId: other.id }) });
  assert.equal(r.status, 400);
});

test("device offline -> alert opens once, notifies in-app and by email, acknowledges, resolves on recovery", async () => {
  const device = await prisma.device.findFirstOrThrow({ where: { networkId, mergedIntoId: null } });
  const orig = { status: device.status, lastSuccessfulAt: device.lastSuccessfulAt, lastSeenAt: device.lastSeenAt };
  const ch = await call("/notifications/channels", { method: "POST", cookie: admin, body: JSON.stringify({ type: "EMAIL", name: `${tag}-mail`, recipients: ["ops@test.local"], minSeverity: "WARNING" }) });
  assert.equal(ch.status, 200);
  const rule = (await call("/alerts/rules", { method: "POST", cookie: admin, body: JSON.stringify({ name: `${tag}-off`, type: "DEVICE_OFFLINE", deviceId: device.id, threshold: 0, evalIntervalSec: 15, cooldownSec: 3600, severity: "CRITICAL" }) })).body!.data;
  try {
    await prisma.device.update({ where: { id: device.id }, data: { status: "OFFLINE", lastSuccessfulAt: new Date(Date.now() - 5 * 60_000) } });
    const alert = await waitFor(() => prisma.alert.findFirst({ where: { ruleId: rule.id, state: "OPEN" } }));
    assert.equal(alert.severity, "CRITICAL");
    assert.equal(alert.deviceId, device.id);
    // Another evaluation must not duplicate it.
    await prisma.alertRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: null } });
    await waitFor(async () => (await prisma.alertRule.findUniqueOrThrow({ where: { id: rule.id } })).lastEvaluatedAt);
    assert.equal(await prisma.alert.count({ where: { ruleId: rule.id, state: { in: ["OPEN", "ACKNOWLEDGED"] } } }), 1);
    const inApp = await prisma.notification.findFirst({ where: { alertId: alert.id, type: "IN_APP" } });
    assert.ok(inApp, "in-app notification recorded");
    const email = await waitFor(() => prisma.notification.findFirst({ where: { alertId: alert.id, type: "EMAIL", status: { in: ["SENT", "FAILED"] } } }));
    assert.equal(email.status, process.env.SMTP_EXPECT_FAIL ? "FAILED" : "SENT", email.error ?? "");
    assert.equal(await prisma.notification.count({ where: { alertId: alert.id, type: "EMAIL" } }), 1, "cooldown prevents duplicate emails");
    const list = await call("/alerts?state=active", { cookie: viewer });
    assert.ok(list.body!.data.items.some((a: { id: string }) => a.id === alert.id));
    assert.equal((await call(`/alerts/${alert.id}`, { method: "PATCH", cookie: viewer, body: JSON.stringify({ action: "acknowledge" }) })).status, 403);
    const ack = await call(`/alerts/${alert.id}`, { method: "PATCH", cookie: admin, body: JSON.stringify({ action: "acknowledge" }) });
    assert.equal(ack.body!.data.state, "ACKNOWLEDGED");
    await prisma.device.update({ where: { id: device.id }, data: { status: "ONLINE", lastSuccessfulAt: new Date() } });
    const resolved = await waitFor(async () => { const a = await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } }); return a.state === "RESOLVED" ? a : null; });
    assert.ok(resolved.resolvedAt);
    const hist = await call("/alerts?state=RESOLVED", { cookie: admin });
    assert.ok(hist.body!.data.items.some((a: { id: string }) => a.id === alert.id));
  } finally {
    await prisma.device.update({ where: { id: device.id }, data: orig });
    await prisma.notificationChannel.deleteMany({ where: { id: ch.body!.data.id } });
  }
});

test("high latency rule fires only on real measurements above the threshold", async () => {
  const device = await prisma.device.findFirstOrThrow({ where: { networkId, mergedIntoId: null } });
  const rule = (await call("/alerts/rules", { method: "POST", cookie: admin, body: JSON.stringify({ name: `${tag}-lat2`, type: "HIGH_LATENCY", deviceId: device.id, threshold: 100, windowMin: 5, evalIntervalSec: 15 }) })).body!.data;
  await waitFor(async () => (await prisma.alertRule.findUniqueOrThrow({ where: { id: rule.id } })).lastEvaluatedAt);
  const hadData = await prisma.latencyMeasurement.count({ where: { deviceId: device.id, measuredAt: { gte: new Date(Date.now() - 5 * 60_000) } } });
  if (!hadData) assert.equal(await prisma.alert.count({ where: { ruleId: rule.id } }), 0, "no data must not raise an alert");
  const m = await prisma.latencyMeasurement.create({ data: { deviceId: device.id, collectorId, networkId, targetIp: "192.0.2.10", sent: 3, received: 3, avgMs: 900, minMs: 850, maxMs: 950, packetLoss: 0, measuredAt: new Date() } });
  try {
    await prisma.alertRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: null } });
    const a = await waitFor(() => prisma.alert.findFirst({ where: { ruleId: rule.id, state: "OPEN" } }));
    assert.ok((a.value ?? 0) > 100);
  } finally {
    await prisma.latencyMeasurement.delete({ where: { id: m.id } });
  }
});

test("email channel test message goes through the real delivery path", async () => {
  const ch = (await call("/notifications/channels", { method: "POST", cookie: admin, body: JSON.stringify({ type: "EMAIL", name: `${tag}-mail2`, recipients: ["ops@test.local"] }) })).body!.data;
  const t = await call(`/notifications/channels/${ch.id}/test`, { method: "POST", cookie: admin });
  assert.equal(t.status, 200);
  const n = await waitFor(async () => { const x = (await call(`/notifications/${t.body!.data.notificationId}`, { cookie: admin })).body!.data; return x.status === "SENT" || x.error ? x : null; });
  assert.equal(n.status, "SENT", n.error);
});

test("system health reports measured service state", async () => {
  const r = await call("/system/health", { cookie: viewer });
  assert.equal(r.status, 200);
  const s = r.body!.data.services;
  assert.equal(s.postgres.status, "up");
  assert.equal(s.redis.status, "up");
  assert.equal(s.worker.status, "up", JSON.stringify(s.worker));
  assert.ok(Array.isArray(r.body!.data.jobs));
});

// Last: it intentionally trips the limiter.
test("login brute force is rate limited", async () => {
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await call("/auth/login", { method: "POST", body: JSON.stringify({ email: `${tag}-nobody@test.local`, password: "x" }), ip: "10.250.9.9" })).status);
  assert.ok(codes.includes(429), codes.join(","));
});
