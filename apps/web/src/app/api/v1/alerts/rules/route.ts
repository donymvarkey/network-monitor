import { alertRuleSchema } from "@netmon/shared-validation";
import { handler, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertRuleScope } from "./scope";

export const GET = handler(async () => {
  const rules = await prisma.alertRule.findMany({ orderBy: { createdAt: "asc" }, include: { network: { select: { id: true, name: true } }, _count: { select: { alerts: { where: { state: { in: ["OPEN", "ACKNOWLEDGED"] } } } } } } });
  return ok(rules.map(({ _count, ...r }) => ({ ...r, activeAlerts: _count.alerts })));
});

export const POST = handler(async (req) => {
  const user = await requireAdmin();
  const body = alertRuleSchema.parse(await req.json());
  await assertRuleScope(body);
  const rule = await prisma.alertRule.create({ data: body });
  await audit("alert_rule.create", { userId: user.userId, target: rule.id, data: { type: rule.type, name: rule.name } });
  return ok(rule);
}, { admin: true });
