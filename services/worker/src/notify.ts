import type { PrismaClient, AlertSeverity, NotificationChannel } from "@prisma/client";
import { severityAtLeast, shouldNotify } from "@netmon/network-core";
import nodemailer, { type Transporter } from "nodemailer";
import type { AlertChange } from "./alerts.js";

/**
 * Extensible delivery: each channel type implements `send`. Add TELEGRAM / DISCORD / WEBHOOK by
 * registering another sender — the queue, retries and status tracking stay the same.
 */
export interface Sender { send(channel: NotificationChannel, msg: { title: string; body: string }): Promise<void> }

let transporter: Transporter | null = null;
export function smtpConfigured(): boolean { return !!process.env.SMTP_HOST && !!process.env.SMTP_FROM; }
function smtp(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
  }
  return transporter;
}

export const SENDERS: Partial<Record<NotificationChannel["type"], Sender>> = {
  EMAIL: {
    async send(channel, msg) {
      if (!smtpConfigured()) throw new Error("SMTP is not configured (SMTP_HOST / SMTP_FROM)");
      const to = ((channel.config as { recipients?: string[] }).recipients ?? []).filter(Boolean);
      if (!to.length) throw new Error("Email channel has no recipients");
      await smtp().sendMail({ from: process.env.SMTP_FROM, to, subject: `[NetWatch] ${msg.title}`, text: msg.body });
    },
  },
};

/** Creates notification rows for alert changes; email rows are delivered by the notify queue. */
export async function fanOut(prisma: PrismaClient, changes: AlertChange[], now = new Date()): Promise<string[]> {
  if (!changes.length) return [];
  const channels = await prisma.notificationChannel.findMany({ where: { enabled: true } });
  const pending: string[] = [];
  for (const c of changes) {
    const alert = await prisma.alert.findUnique({ where: { id: c.alertId }, include: { rule: true } });
    if (!alert) continue;
    if (c.kind === "triggered" && !shouldNotify(alert.lastNotifiedAt, now, alert.rule?.cooldownSec ?? 0)) continue;
    const title = c.kind === "resolved" ? `Resolved: ${c.title}` : c.title;
    const body = `${title}\nSeverity: ${c.severity}\nTriggered: ${alert.triggeredAt.toISOString()}${alert.resolvedAt ? `\nResolved: ${alert.resolvedAt.toISOString()}` : ""}\nRule: ${alert.rule?.name ?? "-"}`;
    // In-app notifications are always recorded (read by the bell in the header).
    await prisma.notification.create({ data: { alertId: alert.id, type: "IN_APP", kind: c.kind, title, body, status: "SENT", sentAt: now } });
    for (const ch of channels) {
      if (ch.type === "IN_APP") continue;
      if (!c.notifyEmail && ch.type === "EMAIL") continue;
      if (!severityAtLeast(c.severity, ch.minSeverity as AlertSeverity)) continue;
      const n = await prisma.notification.create({ data: { alertId: alert.id, channelId: ch.id, type: ch.type, kind: c.kind, title, body, status: SENDERS[ch.type] ? "PENDING" : "SKIPPED", error: SENDERS[ch.type] ? null : `${ch.type} delivery is not implemented yet` } });
      if (SENDERS[ch.type]) pending.push(n.id);
    }
    await prisma.alert.update({ where: { id: alert.id }, data: { lastNotifiedAt: now } });
  }
  return pending;
}

/** Delivers one notification. Throws so BullMQ retries with backoff; final status written either way. */
export async function deliver(prisma: PrismaClient, id: string, finalAttempt: boolean): Promise<void> {
  const n = await prisma.notification.findUnique({ where: { id }, include: { channel: true } });
  if (!n || n.status === "SENT" || !n.channel) return;
  const sender = SENDERS[n.channel.type];
  try {
    if (!sender) throw new Error(`${n.channel.type} delivery is not implemented`);
    await sender.send(n.channel, { title: n.title, body: n.body });
    await prisma.notification.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: null } });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.notification.update({ where: { id }, data: { attempts: { increment: 1 }, error: msg, ...(finalAttempt && { status: "FAILED" }) } });
    throw e;
  }
}
