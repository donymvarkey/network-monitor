import { topologyLayoutSchema } from "@netmon/shared-validation";
import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Saves dragged node positions. Layout only — never changes relationships. */
export const PUT = handler(async (req) => {
  const { positions } = topologyLayoutSchema.parse(await req.json());
  await prisma.$transaction(positions.map((p) => prisma.topologyNodePosition.upsert({ where: { nodeId: p.id }, update: { x: p.x, y: p.y }, create: { nodeId: p.id, x: p.x, y: p.y } })));
  return ok({ saved: positions.length });
});
export const DELETE = handler(async () => {
  const r = await prisma.topologyNodePosition.deleteMany({});
  return ok({ cleared: r.count });
});
