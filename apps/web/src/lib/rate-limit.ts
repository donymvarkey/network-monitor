import "server-only";
import { redis } from "./redis";

/** Fixed-window limiter backed by Redis. Returns true when allowed. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  return n <= limit;
}
