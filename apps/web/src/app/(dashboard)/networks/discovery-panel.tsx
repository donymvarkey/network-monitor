"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { api } from "@/lib/fetcher";
import { EmptyState } from "@/components/empty-state";
import { StatusDot, ago } from "@/components/status-dot";

interface Net { id: string; name: string; cidr: string }
interface Scan { id: string; status: string; progress: number; hostsTotal: number | null; hostsScanned: number; devicesFound: number; errors: string[]; createdAt: string; finishedAt: string | null }

export function DiscoveryPanel() {
  const nets = useQuery({ queryKey: ["networks"], queryFn: () => api<Net[]>("/networks?pageSize=200") });
  const list = (nets.data?.data ?? []);
  const [sel, setSel] = useState<string>("");
  const networkId = sel || list[0]?.id || "";
  const qc = useQueryClient();
  const scans = useQuery({
    queryKey: ["scans", networkId], enabled: !!networkId,
    queryFn: () => api<Scan[]>(`/networks/${networkId}/scans`),
    refetchInterval: (q) => (q.state.data?.data[0] && ["QUEUED", "DISPATCHED", "RUNNING"].includes(q.state.data.data[0].status) ? 3000 : false),
  });
  const start = useMutation({ mutationFn: () => api(`/networks/${networkId}/discover`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["scans", networkId] }) });

  if (!nets.isLoading && list.length === 0) return <EmptyState icon={Network} title="No networks yet" body="Networks are created when a collector registers with its NETWORK_CIDRS. See the collector README." />;
  const latest = scans.data?.data[0];
  const active = latest && ["QUEUED", "DISPATCHED", "RUNNING"].includes(latest.status);
  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <select value={networkId} onChange={(e) => setSel(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm">
          {list.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.cidr})</option>)}
        </select>
        <button onClick={() => start.mutate()} disabled={!networkId || start.isPending || !!active} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{active ? "Scan in progress" : "Start scan"}</button>
        <Link href={`/devices`} className="text-sm text-muted-foreground hover:text-foreground">View devices →</Link>
        {start.error && <p className="w-full text-sm text-destructive">{(start.error as Error).message}</p>}
      </div>
      {latest && (
        <div className="panel space-y-2 p-4 text-sm">
          <div className="flex items-center gap-3"><span className="font-medium">Latest scan</span><StatusDot status={latest.status} /><span className="text-xs text-muted-foreground">{ago(latest.createdAt)}</span></div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${latest.progress}%` }} /></div>
          <p className="text-xs text-muted-foreground">{latest.hostsScanned}/{latest.hostsTotal ?? "?"} hosts · {latest.devicesFound} devices found</p>
          {latest.errors.length > 0 && <ul className="space-y-1 rounded-md border border-destructive/40 p-2 text-xs text-destructive">{latest.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
      {scans.data && scans.data.data.length > 1 && (
        <div className="panel p-4 text-sm"><h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Scan history</h2>
          {scans.data.data.slice(1).map((s) => <div key={s.id} className="flex justify-between border-b py-1.5 last:border-0 text-xs"><StatusDot status={s.status} /><span>{s.devicesFound} devices</span><span className="text-muted-foreground">{ago(s.createdAt)}</span></div>)}
        </div>
      )}
    </div>
  );
}
