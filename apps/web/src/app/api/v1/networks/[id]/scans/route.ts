import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  return ok(await prisma.scanJob.findMany({ where: { networkId: id }, orderBy: { createdAt: "desc" }, take: 20 }));
});
