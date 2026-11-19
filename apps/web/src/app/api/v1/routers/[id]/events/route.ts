import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  return ok(await prisma.networkEvent.findMany({ where: { type: { startsWith: "router." }, data: { path: ["routerId"], equals: id } }, orderBy: { occurredAt: "desc" }, take: 100 }));
});
