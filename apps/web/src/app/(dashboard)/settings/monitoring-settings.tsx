"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { StatusDot, ago } from "@/components/status-dot";

interface Net { id: string; name: string; cidr: string; monitorIntervalSec: number; pingCount: number; offlineThreshold: number; lastMonitoredAt: string | null; primaryCollector: { name: string; status: string } | null }
interface Status { networks: Net[]; failures: { id: string; queue: string; jobName: string; attemptsMade: number; final: boolean; error: string; failedAt: string }[]; tasks24h: Record<string, number> }

export function MonitoringSettings() {
  const q = useQuery({ queryKey: ["monitoring"], queryFn: async () => (await api<Status>("/monitoring")).data });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error | null)?.message ?? "Unavailable"}</p>;
  const t = q.data.tasks24h;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-sm font-medium">Per-network monitoring</h2>
        <p className="mb-3 text-xs text-muted-foreground">The worker asks each network's primary collector to ping every known device on this interval. Router polling intervals are set on each router.</p>
        {q.data.networks.length === 0 ? <p className="panel p-4 text-sm text-muted-foreground">No networks configured yet.</p> : (
          <div className="space-y-2">{q.data.networks.map((n) => <NetworkRow key={n.id} n={n} />)}</div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Monitoring rounds, last 24 hours</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(["COMPLETED", "EXPIRED", "DISPATCHED", "PENDING"] as const).map((k) => <div key={k} className="panel p-3"><div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.toLowerCase()}</div><div className="mt-1 font-mono text-lg">{t[k] ?? 0}</div></div>)}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Recent job failures</h2>
        {q.data.failures.length === 0 ? <p className="panel p-4 text-sm text-muted-foreground">No failures recorded.</p> : (
          <div className="panel divide-y text-xs">{q.data.failures.map((f) => <div key={f.id} className="px-3 py-2"><div className="flex justify-between"><span className="font-mono">{f.queue} / {f.jobName}{f.final ? " · final" : ` · attempt ${f.attemptsMade}`}</span><span className="text-muted-foreground">{ago(f.failedAt)}</span></div><div className="text-muted-foreground">{f.error}</div></div>)}</div>
        )}
      </section>
    </div>
  );
}

function NetworkRow({ n }: { n: Net }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ monitorIntervalSec: n.monitorIntervalSec, pingCount: n.pingCount, offlineThreshold: n.offlineThreshold });
  const save = useMutation({
    mutationFn: () => api(`/networks/${n.id}/monitoring`, { method: "PATCH", body: JSON.stringify(f) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["monitoring"] }),
  });
  const num = (k: keyof typeof f, label: string, min: number, max: number, unit?: string) => (
    <label className="text-xs text-muted-foreground">{label}
      <span className="mt-1 flex items-center gap-1"><input type="number" min={min} max={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} className="w-20 rounded-md border bg-background px-2 py-1 text-sm text-foreground" />{unit}</span>
    </label>
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="panel flex flex-wrap items-end gap-4 p-3">
      <div className="min-w-48 flex-1">
        <div className="text-sm font-medium">{n.name} <span className="font-mono text-xs text-muted-foreground">{n.cidr}</span></div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {n.primaryCollector ? <>Primary: {n.primaryCollector.name} <StatusDot status={n.primaryCollector.status} /></> : <span className="text-warning">No primary collector — monitoring paused</span>}
          <span>· last round {ago(n.lastMonitoredAt)}</span>
        </div>
      </div>
      {num("monitorIntervalSec", "Interval", 15, 3600, "s")}
      {num("pingCount", "Pings per target", 1, 10)}
      {num("offlineThreshold", "Offline after failures", 1, 20)}
      <button disabled={save.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{save.isPending ? "Saving…" : "Save"}</button>
      {save.isSuccess && <span className="text-xs text-success">Saved</span>}
      {save.error && <span className="text-xs text-destructive">{(save.error as Error).message}</span>}
    </form>
  );
}
