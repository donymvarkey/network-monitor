import { handler, ok, parsePagination } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async (req, { params }) => {
  const { id } = await params;
  const { page, pageSize } = parsePagination(req);
  const where = { networkId: id, mergedIntoId: null };
  const [items, total] = await Promise.all([
    prisma.device.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } } }),
    prisma.device.count({ where }),
  ]);
  return ok(items, { page, pageSize, total });
});
