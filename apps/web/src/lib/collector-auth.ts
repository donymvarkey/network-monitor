import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { ApiError } from "./api";
import { rateLimit } from "./rate-limit";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
/** 256-bit random token; only its SHA-256 is stored. */
export function newCollectorToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** Collector auth is independent from browser sessions: Bearer COLLECTOR_TOKEN + X-Collector-Id. */
export async function requireCollector(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const name = req.headers.get("x-collector-id") ?? "";
  if (!token || !name || token.length > 200 || name.length > 100) throw new ApiError(401, "COLLECTOR_UNAUTHORIZED", "Missing collector credentials");
  // Limit per collector name: a leaked name cannot be used to brute-force tokens.
  if (!(await rateLimit(`collector:${name}`, Number(process.env.COLLECTOR_RATE_LIMIT_PER_MIN ?? 600), 60))) throw new ApiError(429, "RATE_LIMITED", "Collector request rate exceeded");
  const hash = hashToken(token);
  const c = await prisma.collector.findUnique({ where: { tokenHash: hash } });
  if (!c || !timingSafeEqual(Buffer.from(c.tokenHash), Buffer.from(hash)) || c.name !== name) {
    throw new ApiError(401, "COLLECTOR_UNAUTHORIZED", "Invalid collector credentials");
  }
  if (c.revokedAt) throw new ApiError(401, "COLLECTOR_REVOKED", "Collector token has been revoked");
  return c;
}

/** Network authorization: a collector may only touch networks it is linked to. */
export async function assertCollectorNetwork(collectorId: string, networkId: string): Promise<void> {
  const link = await prisma.collectorNetwork.findUnique({ where: { collectorId_networkId: { collectorId, networkId } } });
  if (!link) throw new ApiError(403, "NETWORK_FORBIDDEN", "Collector is not assigned to this network");
}
