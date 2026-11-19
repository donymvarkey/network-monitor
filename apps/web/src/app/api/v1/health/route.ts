import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const GET = handler(async () => {
  const [db, cache] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "up").catch(() => "down"),
    redis.ping().then(() => "up").catch(() => "down"),
  ]);
  return ok({ status: db === "up" && cache === "up" ? "ok" : "degraded", database: db, redis: cache });
}, { public: true });
