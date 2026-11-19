import { eventQuerySchema } from "@netmon/shared-validation";
import { handler } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { eventInclude, eventWhere } from "@/services/events";

export const dynamic = "force-dynamic";
const MAX_ROWS = 50_000;
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Quote, escape quotes, and neutralise spreadsheet formula injection.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** CSV of the currently filtered events, streamed in pages of 1000. */
export const GET = handler(async (req) => {
  const q = eventQuerySchema.parse({ ...Object.fromEntries(req.nextUrl.searchParams), page: 1, pageSize: 1 });
  const where = eventWhere(q);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode("occurred_at,severity,category,type,message,network,device,data\n"));
      let cursor: string | undefined; let sent = 0;
      while (sent < MAX_ROWS) {
        const rows = await prisma.networkEvent.findMany({ where, include: eventInclude, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 1000, ...(cursor && { skip: 1, cursor: { id: cursor } }) });
        if (!rows.length) break;
        ctrl.enqueue(enc.encode(rows.map((e) => [e.occurredAt.toISOString(), e.severity, e.type.split(".")[0], e.type, e.message, e.network?.name, e.device?.displayName ?? e.device?.hostname, e.data].map(cell).join(",")).join("\n") + "\n"));
        sent += rows.length; cursor = rows[rows.length - 1]!.id;
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="netwatch-events-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
});
