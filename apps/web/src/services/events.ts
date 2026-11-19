import "server-only";
import type { Prisma } from "@prisma/client";
import type { EventQuery } from "@netmon/shared-validation";

/** One filter builder shared by the paginated list and CSV export. Category = type prefix. */
export function eventWhere(q: EventQuery): Prisma.NetworkEventWhereInput {
  const and: Prisma.NetworkEventWhereInput[] = [];
  if (q.category) and.push({ type: { startsWith: `${q.category}.` } });
  if (q.severity) and.push({ severity: q.severity });
  if (q.deviceId) and.push({ deviceId: q.deviceId });
  if (q.networkId) and.push({ networkId: q.networkId });
  if (q.routerId) and.push({ data: { path: ["routerId"], equals: q.routerId } });
  if (q.collectorId) and.push({ data: { path: ["collectorId"], equals: q.collectorId } });
  if (q.from || q.to) and.push({ occurredAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) } });
  if (q.q) and.push({ OR: [{ message: { contains: q.q, mode: "insensitive" } }, { type: { contains: q.q, mode: "insensitive" } }] });
  return and.length ? { AND: and } : {};
}
export const eventInclude = { device: { select: { id: true, displayName: true, hostname: true } }, network: { select: { id: true, name: true } } } satisfies Prisma.NetworkEventInclude;
