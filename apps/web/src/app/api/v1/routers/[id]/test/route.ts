import { pollRouter } from "@netmon/router-adapters";
import { handler, ok, requireUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { publishEvent } from "@/lib/redis";

export const maxDuration = 30;
/** Runs one bounded poll (≈3s timeouts per probe) and stores capability results. */
export const POST = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const res = await pollRouter(prisma as never, id, { persist: true });
  await audit("router.tested", { userId: user.userId, target: id, data: { status: res.status } });
  await publishEvent("router:status_changed", { routerId: id, status: res.status });
  const { clients: _c, interfaces: _i, ...summary } = res;
  return ok(summary);
}, { admin: true });
