import { eventQuerySchema } from "@netmon/shared-validation";
import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { eventInclude, eventWhere } from "@/services/events";

export const dynamic = "force-dynamic";
/** Server-side paginated, filterable timeline (newest first). */
export const GET = handler(async (req) => {
  const q = eventQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const where = eventWhere(q);
  const [items, total] = await Promise.all([
    prisma.networkEvent.findMany({ where, include: eventInclude, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] }),
    prisma.networkEvent.count({ where }),
  ]);
  return ok(items, { page: q.page, pageSize: q.pageSize, total });
});
