import "server-only";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { QUEUES, REDIS_EVENTS_CHANNEL, type QueueName } from "@netmon/network-core";
import type { RealtimeEnvelope, RealtimeEvent } from "@netmon/shared-types";
import { env } from "./env";

const g = globalThis as unknown as { redis?: IORedis; queues?: Map<string, Queue> };
export const redis = g.redis ?? new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
g.redis = redis;

export async function publishEvent<T>(event: RealtimeEvent, payload: T): Promise<void> {
  const msg: RealtimeEnvelope<T> = { event, payload, emittedAt: new Date().toISOString() };
  await redis.publish(REDIS_EVENTS_CHANNEL, JSON.stringify(msg));
}

export function getQueue(name: QueueName | string): Queue {
  g.queues ??= new Map();
  let q = g.queues.get(name);
  if (!q) { q = new Queue(name, { connection: redis }); g.queues.set(name, q); }
  return q;
}
export { QUEUES };
