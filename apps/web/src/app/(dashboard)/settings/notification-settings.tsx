"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/fetcher";
import { useMe } from "@/hooks/use-me";

interface Channel { id: string; type: string; name: string; enabled: boolean; minSeverity: string; config: { recipients?: string[] }; stats7d: Record<string, number> }
interface Data { smtp: { configured: boolean; host: string | null; from: string | null }; implemented: string[]; channels: Channel[] }

export function NotificationSettings() {
  const qc = useQueryClient();
  const { isAdmin } = useMe();
  const q = useQuery({ queryKey: ["notification-channels"], queryFn: async () => (await api<Data>("/notifications/channels")).data });
  const [f, setF] = useState({ name: "Email", recipients: "", minSeverity: "WARNING" });
  const [msg, setMsg] = useState<string | null>(null);
  const inv = () => void qc.invalidateQueries({ queryKey: ["notification-channels"] });
  const add = useMutation({ mutationFn: () => api("/notifications/channels", { method: "POST", body: JSON.stringify({ type: "EMAIL", name: f.name, minSeverity: f.minSeverity, recipients: f.recipients.split(/[,\s]+/).filter(Boolean) }) }), onSuccess: () => { setF({ ...f, recipients: "" }); setMsg(null); inv(); }, onError: (e) => setMsg((e as Error).message) });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api(`/notifications/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: string) => api(`/notifications/channels/${id}`, { method: "DELETE" }), onSuccess: inv });
  const test = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api<{ notificationId: string }>(`/notifications/channels/${id}/test`, { method: "POST" });
      // Poll the real delivery result (worker sends it in the background).
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const n = (await api<{ status: string; error: string | null }>(`/notifications/${data.notificationId}`)).data;
        if (n.status === "SENT") return "Test email sent.";
        if (n.status === "FAILED" || n.error) return `Delivery failed: ${n.error ?? "unknown error"}`;
      }
      return "Still queued — is the worker running?";
    },
    onSuccess: (m) => { setMsg(m); inv(); }, onError: (e) => setMsg((e as Error).message),
  });
  if (!q.data) return <p className="text-sm text-muted-foreground">{q.error ? (q.error as Error).message : "Loading…"}</p>;
  const field = "mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground";
  return (
    <section className="space-y-3">
      <div>
        <h2 className="mb-1 text-sm font-medium">Notifications</h2>
        <p className="text-xs text-muted-foreground">In-app notifications are always on (bell in the header). Email uses the SMTP server set in the environment:{" "}
          {q.data.smtp.configured ? <span className="text-foreground">{q.data.smtp.host}, from {q.data.smtp.from}</span> : <span className="text-warning">not configured — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM in .env and restart the worker.</span>}
        </p>
      </div>
      {q.data.channels.map((c) => (
        <div key={c.id} className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
          <div className="min-w-48 flex-1">
            <div className="font-medium">{c.name} <span className="font-mono text-xs text-muted-foreground">{c.type}</span></div>
            <div className="text-xs text-muted-foreground">{(c.config.recipients ?? []).join(", ")} · {c.minSeverity} and above · last 7 days: {Object.entries(c.stats7d).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "none"}</div>
          </div>
          {isAdmin && <>
            <button onClick={() => test.mutate(c.id)} disabled={test.isPending} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">{test.isPending ? "Sending…" : "Send test"}</button>
            <button onClick={() => patch.mutate({ id: c.id, body: { enabled: !c.enabled } })} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">{c.enabled ? "Disable" : "Enable"}</button>
            <button aria-label="Delete channel" onClick={() => { if (confirm(`Delete ${c.name}?`)) del.mutate(c.id); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </>}
        </div>
      ))}
      {isAdmin && (
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="panel grid gap-3 p-3 md:grid-cols-4">
          <label className="text-xs text-muted-foreground">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={field} /></label>
          <label className="text-xs text-muted-foreground md:col-span-2">Recipients (comma separated)<input required value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} placeholder="you@example.com" className={field} /></label>
          <label className="text-xs text-muted-foreground">Minimum severity<select value={f.minSeverity} onChange={(e) => setF({ ...f, minSeverity: e.target.value })} className={field}>{["INFO", "WARNING", "CRITICAL"].map((s) => <option key={s}>{s}</option>)}</select></label>
          <div className="md:col-span-4"><button className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">Add email channel</button></div>
        </form>
      )}
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <p className="text-xs text-muted-foreground">Telegram, Discord and webhook delivery are planned; the delivery system is built so they can be added without changes to alert rules.</p>
    </section>
  );
}
