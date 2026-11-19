"use client";
import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { MonitorSmartphone, ShieldQuestion } from "lucide-react";
import { api } from "@/lib/fetcher";
import { useDeviceFilters } from "@/stores/devices";
import { EmptyState } from "@/components/empty-state";
import { StatusDot, ago } from "@/components/status-dot";

interface Row { id: string; name: string | null; ip: string | null; mac: string | null; macRandomized: boolean; vendor: string | null; deviceType: string | null; category: string | null; network: { name: string }; status: string; lastSeenAt: string | null; collector: { name: string | null } | null }
interface Net { id: string; name: string; cidr: string }

const COLS: [string, string | null][] = [["Name", "name"], ["IP", null], ["MAC", null], ["Manufacturer", "vendor"], ["Type", null], ["Network", null], ["Status", "status"], ["Last seen", "lastSeenAt"], ["Collector", null]];

export function DeviceTable() {
  const f = useDeviceFilters();
  const params = new URLSearchParams({ page: String(f.page), pageSize: "25", sort: f.sort, ...(f.q && { q: f.q }), ...(f.status && { status: f.status }), ...(f.networkId && { networkId: f.networkId }) });
  const { data, isLoading, error } = useQuery({ queryKey: ["devices", params.toString()], queryFn: () => api<Row[]>(`/devices?${params}`), placeholderData: keepPreviousData });
  const nets = useQuery({ queryKey: ["networks"], queryFn: () => api<Net[]>("/networks?pageSize=200") });
  const total = data?.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));
  const toggleSort = (k: string) => f.set({ sort: f.sort === `-${k}` ? k : `-${k}` });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input value={f.q} onChange={(e) => f.set({ q: e.target.value })} placeholder="Search name, hostname, vendor, MAC…" className="w-64 rounded-md border bg-background px-3 py-1.5 text-sm" />
        <select value={f.status} onChange={(e) => f.set({ status: e.target.value as typeof f.status })} className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="">All statuses</option><option value="ONLINE">Online</option><option value="OFFLINE">Offline</option><option value="UNKNOWN">Unknown</option>
        </select>
        <select value={f.networkId} onChange={(e) => f.set({ networkId: e.target.value })} className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="">All networks</option>
          {nets.data?.data.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.cidr})</option>)}
        </select>
        <span className="ml-auto self-center text-xs text-muted-foreground">{total} devices</span>
      </div>
      {error ? <p className="text-sm text-destructive">{(error as Error).message}</p> : null}
      {!isLoading && total === 0 ? (
        <EmptyState icon={MonitorSmartphone} title="No devices found" body="Run a discovery scan from the Networks page, or adjust your filters." />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>{COLS.map(([l, k]) => <th key={l} className="px-3 py-2 font-medium">{k ? <button onClick={() => toggleSort(k)} className="hover:text-foreground">{l}{f.sort.replace("-", "") === k ? (f.sort.startsWith("-") ? " ↓" : " ↑") : ""}</button> : l}</th>)}</tr>
            </thead>
            <tbody>
              {data?.data.map((d) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-accent/50">
                  <td className="px-3 py-2"><Link href={`/devices/${d.id}`} className="hover:text-primary">{d.name ?? <span className="text-muted-foreground">Unnamed</span>}</Link></td>
                  <td className="px-3 py-2 font-mono text-xs">{d.ip ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.mac ?? "—"}{d.macRandomized && <ShieldQuestion className="ml-1 inline h-3 w-3 text-warning" aria-label="Randomized MAC" />}</td>
                  <td className="px-3 py-2">{d.vendor ?? "—"}</td>
                  <td className="px-3 py-2">{d.category ?? d.deviceType ?? "—"}</td>
                  <td className="px-3 py-2">{d.network.name}</td>
                  <td className="px-3 py-2"><StatusDot status={d.status} /></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{ago(d.lastSeenAt)}</td>
                  <td className="px-3 py-2 text-xs">{d.collector?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button disabled={f.page <= 1} onClick={() => f.set({ page: f.page - 1 })} className="rounded-md border px-2 py-1 disabled:opacity-40">Prev</button>
          <span className="text-xs text-muted-foreground">Page {f.page} / {pages}</span>
          <button disabled={f.page >= pages} onClick={() => f.set({ page: f.page + 1 })} className="rounded-md border px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
