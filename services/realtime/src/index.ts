import { createServer } from "node:http";
import { Redis as IORedis } from "ioredis";
import { Server } from "socket.io";
import { unsealData } from "iron-session";
import { REDIS_EVENTS_CHANNEL } from "@netmon/network-core";
import { REALTIME_EVENTS, type RealtimeEnvelope } from "@netmon/shared-types";

const url = process.env.REDIS_URL;
if (!url) throw new Error("REDIS_URL is required");
const port = Number(process.env.REALTIME_PORT ?? 4001);

const http = createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: redisReady, redis: redisReady ? "up" : "down", clients: io.engine.clientsCount })); return; }
  res.writeHead(404); res.end();
});
const io = new Server(http, { path: "/socket.io", addTrailingSlash: false, // Browsers reach the gateway on the dashboard's own origin (nginx / Next rewrite), so cross-origin is off
// unless APP_ORIGIN is set explicitly.
  cors: process.env.APP_ORIGIN ? { origin: process.env.APP_ORIGIN.split(","), credentials: true } : undefined });
let redisReady = false;
const MAX_AGE_SEC = Number(process.env.SESSION_MAX_AGE_HOURS ?? 12) * 3600;
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET is required");
// Only browsers with a valid dashboard session may subscribe.
io.use(async (socket, next) => {
  const cookie = socket.handshake.headers.cookie ?? "";
  const raw = /(?:^|;\s*)netmon_session=([^;]+)/.exec(cookie)?.[1];
  if (!raw) return next(new Error("unauthorized"));
  try {
    const s = await unsealData<{ userId?: string; iat?: number }>(decodeURIComponent(raw), { password: secret, ttl: MAX_AGE_SEC });
    if (!s.userId || !s.iat || Date.now() / 1000 - s.iat > MAX_AGE_SEC) return next(new Error("unauthorized"));
    socket.data.iat = s.iat;
    return next();
  } catch { return next(new Error("unauthorized")); }
});

// ioredis reconnects and re-subscribes automatically; we only track state for /health.
const sub = new IORedis(url, { retryStrategy: (n) => Math.min(n * 500, 10_000) });
sub.on("ready", () => { redisReady = true; });
sub.on("end", () => { redisReady = false; });
sub.on("error", () => { redisReady = false; });
await sub.subscribe(REDIS_EVENTS_CHANNEL);
redisReady = true;
// Sessions expire while sockets stay open: drop expired ones so they must re-authenticate.
setInterval(() => {
  const now = Date.now() / 1000;
  for (const s of io.sockets.sockets.values()) if (typeof s.data.iat === "number" && now - s.data.iat > MAX_AGE_SEC) s.disconnect(true);
}, 60_000).unref();
sub.on("message", (_ch, raw) => {
  try {
    const msg = JSON.parse(raw) as RealtimeEnvelope;
    if ((REALTIME_EVENTS as readonly string[]).includes(msg.event)) io.emit(msg.event, msg);
  } catch (e) { console.error("Bad event payload", e); }
});

http.listen(port, () => console.log(`Realtime gateway on :${port}`));

const stop = () => { io.close(); void sub.quit().finally(() => process.exit(0)); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
