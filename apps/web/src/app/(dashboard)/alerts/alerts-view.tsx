"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/fetcher";
import { ago } from "@/components/status-dot";
import { EmptyState } from "@/components/empty-state";
import { useMe } from "@/hooks/use-me";

type Sev = "INFO" | "WARNING" | "CRITICAL";
interface Alert { id: string; title: string; severity: Sev; state: "OPEN" | "ACKNOWLEDGED" | "RESOLVED"; triggeredAt: string; resolvedAt: string | null; acknowledgedAt: string | null; lastSeenAt: string; value: number | null; networkName: string | null; device: { id: string; displayName: string | null; hostname: string | null } | null; rule: { name: string; type: string } | null; acknowledgedBy: { email: string } | null }
interface Rule { id: string; name: string; type: string; networkId: string | null; deviceId: string | null; routerId: string | null; threshold: number | null; windowMin: number; evalIntervalSec: number; cooldownSec: number; severity: Sev; enabled: boolean; notifyEmail: boolean; lastEvaluatedAt: string | null; activeAlerts: number; network: { name: string } | null }
interface Net { id: string; name: string; cidr: string }

export const RULE_TYPES: Record<string, { label: string; threshold?: string; hint: string; def?: number }> = {
  DEVICE_OFFLINE: { label: "Device offline", threshold: "Minutes offline before alerting", hint: "Uses the consecutive-failure status from monitoring.", def: 2 },
  DEVICE_ONLINE: { label: "Device back online", hint: "Fires once each time a device recovers." },
  ROUTER_OFFLINE: { label: "Router or modem offline", threshold: "Minutes unreachable", hint: "From router polling.", def: 2 },
  COLLECTOR_DISCONNECTED: { label: "Collector disconnected", threshold: "Minutes without heartbeat", hint: "Collector heartbeats.", def: 0 },
  HIGH_LATENCY: { label: "High latency", threshold: "Average latency above (ms)", hint: "Average over the window.", def: 150 },
  HIGH_PACKET_LOSS: { label: "High packet loss", threshold: "Loss above (0–1, e.g. 0.2 = 20 %)", hint: "Devices that block ping are skipped.", def: 0.2 },
  HIGH_BANDWIDTH: { label: "Unusual bandwidth", threshold: "Average above (bits/s)", hint: "Needs per-device traffic (router client stats or NetFlow).", def: 50_000_000 },
  NETWORK_UNAVAILABLE: { label: "Network unavailable", hint: "No device online, or every collector disconnected." },
  MONITORING_FAILURE: { label: "Monitoring service failure", threshold: "Failed jobs allowed in window", hint: "Final job failures or a silent worker.", def: 0 },
};
const sevClass: Record<Sev, string> = { INFO: "text-muted-foreground", WARNING: "text-warning", CRITICAL: "text-destructive" };

export function AlertsView() {
  const [tab, setTab] = useState<"active" | "RESOLVED" | "rules">("active");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b">
        {([["active", "Active"], ["RESOLVED", "History"], ["rules", "Rules"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l}</button>
        ))}
      </div>
      {tab === "rules" ? <Rules /> : <AlertList state={tab} />}
    </div>
  );
}

function AlertList({ state }: { state: "active" | "RESOLVED" }) {
  const qc = useQueryClient();
  const { isAdmin } = useMe();
  const q = useQuery({ queryKey: ["alerts", state], queryFn: () => api<{ items: Alert[]; counts: Record<string, number> }>(`/alerts?state=${state}&pageSize=100`) });
  const act = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => api(`/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ action }) }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }) });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const items = q.data?.data.items ?? [];
  if (!items.length) return <EmptyState icon={Bell} title={state === "active" ? "No active alerts" : "No resolved alerts yet"} body={state === "active" ? "Nothing is currently breaching a rule." : "Resolved alerts are kept here as history."} />;
  return (
    <div className="panel divide-y">
      {items.map((a) => (
        <div key={a.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5 text-sm">
          <span className={`w-20 shrink-0 font-mono text-xs ${sevClass[a.severity]}`}>{a.severity}</span>
          <div className="min-w-48 flex-1">
            <div>{a.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {a.rule?.name ?? "Rule deleted"}{a.networkName && ` · ${a.networkName}`} · triggered {ago(a.triggeredAt)}
              {a.state === "ACKNOWLEDGED" && ` · acknowledged by ${a.acknowledgedBy?.email ?? "?"} ${ago(a.acknowledgedAt)}`}
              {a.resolvedAt && ` · resolved ${ago(a.resolvedAt)}`}
            </div>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{a.state.toLowerCase()}</span>
          {isAdmin && a.state !== "RESOLVED" && (
            <div className="flex gap-2">
              {a.state === "OPEN" && <button onClick={() => act.mutate({ id: a.id, action: "acknowledge" })} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Acknowledge</button>}
              <button onClick={() => act.mutate({ id: a.id, action: "resolve" })} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Resolve</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const blank = { name: "", type: "DEVICE_OFFLINE", networkId: "", threshold: "2", windowMin: 10, evalIntervalSec: 60, cooldownSec: 900, severity: "WARNING" as Sev, notifyEmail: true, enabled: true };

function Rules() {
  const qc = useQueryClient();
  const { isAdmin } = useMe();
  const rules = useQuery({ queryKey: ["alerts", "rules"], queryFn: async () => (await api<Rule[]>("/alerts/rules")).data });
  const nets = useQuery({ queryKey: ["networks", "list"], queryFn: async () => (await api<Net[]>("/networks?pageSize=100")).data });
  const [form, setForm] = useState<typeof blank | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inv = () => void qc.invalidateQueries({ queryKey: ["alerts"] });
  const save = useMutation({
    mutationFn: (f: typeof blank) => api("/alerts/rules", { method: "POST", body: JSON.stringify({ ...f, networkId: f.networkId || null, threshold: RULE_TYPES[f.type]?.threshold && f.threshold !== "" ? Number(f.threshold) : null }) }),
    onSuccess: () => { setForm(null); setErr(null); inv(); }, onError: (e) => setErr((e as Error).message),
  });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api(`/alerts/rules/${id}`, { method: "PATCH", body: JSON.stringify(body) }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: string) => api(`/alerts/rules/${id}`, { method: "DELETE" }), onSuccess: inv });

  const field = "mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground";
  return (
    <div className="space-y-3">
      {isAdmin && !form && <button onClick={() => setForm({ ...blank })} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"><Plus className="h-4 w-4" />New rule</button>}
      {form && (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(form); }} className="panel grid gap-3 p-4 md:grid-cols-3">
          <label className="text-xs text-muted-foreground">Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} /></label>
          <label className="text-xs text-muted-foreground">Condition
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, threshold: String(RULE_TYPES[e.target.value]?.def ?? "") })} className={field}>
              {Object.entries(RULE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <span className="mt-1 block">{RULE_TYPES[form.type]?.hint}</span>
          </label>
          <label className="text-xs text-muted-foreground">Network
            <select value={form.networkId} onChange={(e) => setForm({ ...form, networkId: e.target.value })} className={field}>
              <option value="">All networks</option>
              {(nets.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.name} ({n.cidr})</option>)}
            </select>
          </label>
          {RULE_TYPES[form.type]?.threshold && <label className="text-xs text-muted-foreground">{RULE_TYPES[form.type]!.threshold}<input type="number" step="any" min={0} value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} className={field} /></label>}
          <label className="text-xs text-muted-foreground">Window (minutes)<input type="number" min={1} max={1440} value={form.windowMin} onChange={(e) => setForm({ ...form, windowMin: Number(e.target.value) })} className={field} /></label>
          <label className="text-xs text-muted-foreground">Check every (seconds)<input type="number" min={15} value={form.evalIntervalSec} onChange={(e) => setForm({ ...form, evalIntervalSec: Number(e.target.value) })} className={field} /></label>
          <label className="text-xs text-muted-foreground">Cooldown between notifications (seconds)<input type="number" min={0} value={form.cooldownSec} onChange={(e) => setForm({ ...form, cooldownSec: Number(e.target.value) })} className={field} /></label>
          <label className="text-xs text-muted-foreground">Severity
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Sev })} className={field}>{["INFO", "WARNING", "CRITICAL"].map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={form.notifyEmail} onChange={(e) => setForm({ ...form, notifyEmail: e.target.checked })} />Send email</label>
          {err && <p className="text-sm text-destructive md:col-span-3">{err}</p>}
          <div className="flex gap-2 md:col-span-3">
            <button disabled={save.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">Create rule</button>
            <button type="button" onClick={() => { setForm(null); setErr(null); }} className="rounded-md border px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </form>
      )}
      {rules.data?.length === 0 && !form && <EmptyState icon={Bell} title="No alert rules" body="Create a rule to be notified when devices, routers or collectors go down, or when latency, loss or bandwidth cross a threshold." />}
      {!!rules.data?.length && (
        <div className="panel overflow-x-auto"><table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><tr>{["Rule", "Condition", "Scope", "Threshold", "Every", "Cooldown", "Severity", "Active", "Last checked", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{rules.data.map((r) => (
            <tr key={r.id} className={`border-b last:border-0 ${r.enabled ? "" : "opacity-60"}`}>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2 text-xs">{RULE_TYPES[r.type]?.label ?? r.type}</td>
              <td className="px-3 py-2 text-xs">{r.network?.name ?? "All networks"}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.threshold ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.evalIntervalSec}s</td>
              <td className="px-3 py-2 font-mono text-xs">{r.cooldownSec}s</td>
              <td className={`px-3 py-2 font-mono text-xs ${sevClass[r.severity]}`}>{r.severity}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.activeAlerts}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{r.enabled ? ago(r.lastEvaluatedAt) : "disabled"}</td>
              <td className="px-3 py-2">{isAdmin && <div className="flex items-center gap-2">
                <button onClick={() => patch.mutate({ id: r.id, body: { enabled: !r.enabled } })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">{r.enabled ? "Disable" : "Enable"}</button>
                <EditThreshold rule={r} onSave={(body) => patch.mutate({ id: r.id, body })} />
                <button aria-label="Delete rule" onClick={() => { if (confirm(`Delete rule "${r.name}"?`)) del.mutate(r.id); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function EditThreshold({ rule, onSave }: { rule: Rule; onSave: (b: object) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ threshold: rule.threshold ?? "", evalIntervalSec: rule.evalIntervalSec, cooldownSec: rule.cooldownSec, severity: rule.severity });
  if (!open) return <button onClick={() => setOpen(true)} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">Edit</button>;
  const f = "w-20 rounded-md border bg-background px-1.5 py-0.5 text-xs";
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ threshold: v.threshold === "" ? null : Number(v.threshold), evalIntervalSec: v.evalIntervalSec, cooldownSec: v.cooldownSec, severity: v.severity }); setOpen(false); }} className="flex items-center gap-1">
      {RULE_TYPES[rule.type]?.threshold && <input aria-label="Threshold" type="number" step="any" value={v.threshold} onChange={(e) => setV({ ...v, threshold: e.target.value })} className={f} />}
      <input aria-label="Interval" type="number" min={15} value={v.evalIntervalSec} onChange={(e) => setV({ ...v, evalIntervalSec: Number(e.target.value) })} className={f} />
      <input aria-label="Cooldown" type="number" min={0} value={v.cooldownSec} onChange={(e) => setV({ ...v, cooldownSec: Number(e.target.value) })} className={f} />
      <select aria-label="Severity" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value as Sev })} className={f}>{["INFO", "WARNING", "CRITICAL"].map((s) => <option key={s}>{s}</option>)}</select>
      <button className="rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground">Save</button>
    </form>
  );
}
