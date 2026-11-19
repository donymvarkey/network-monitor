import { alertRulePatchSchema } from "@netmon/shared-validation";
import { ApiError, handler, ok, requireAdmin } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertRuleScope } from "../scope";

export const PATCH = handler(async (req, { params }) => {
  const { id } = await params;
  const user = await requireAdmin();
  const body = alertRulePatchSchema.parse(await req.json());
  const cur = await prisma.alertRule.findUnique({ where: { id } });
  if (!cur) throw new ApiError(404, "NOT_FOUND", "Rule not found");
  await assertRuleScope({ networkId: body.networkId === undefined ? cur.networkId : body.networkId, deviceId: body.deviceId === undefined ? cur.deviceId : body.deviceId, routerId: body.routerId === undefined ? cur.routerId : body.routerId });
  const rule = await prisma.alertRule.update({ where: { id }, data: { ...body, lastEvaluatedAt: null } });
  // Disabling a rule closes its open alerts so they do not linger as "active".
  if (body.enabled === false) await prisma.alert.updateMany({ where: { ruleId: id, state: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { state: "RESOLVED", resolvedAt: new Date() } });
  await audit("alert_rule.update", { userId: user.userId, target: id, data: body });
  return ok(rule);
}, { admin: true });

export const DELETE = handler(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireAdmin();
  await prisma.alert.updateMany({ where: { ruleId: id, state: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { state: "RESOLVED", resolvedAt: new Date() } });
  await prisma.alertRule.delete({ where: { id } }).catch(() => { throw new ApiError(404, "NOT_FOUND", "Rule not found"); });
  await audit("alert_rule.delete", { userId: user.userId, target: id });
  return ok(null);
}, { admin: true });
