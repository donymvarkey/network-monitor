"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "@/lib/fetcher";
import { StatusDot, ago } from "@/components/status-dot";
import { CAP_LABEL, IntegrationBadge, formatUptime } from "@/components/integration-badge";
import { RouterForm } from "../router-form";
import { cn } from "@/lib/utils";

interface Cap { capability: string; state: string; detail: string | null; checkedAt: string | null }
interface Detail { id: string; name: string; manufacturer: string | null; model: string | null; firmware: string | null; managementIp: string | null; lanIp: string | null; wanIp: string | null; wanUp: boolean | null; uptimeSec: number | null; status: string; integrationStatus: string; integrationError: string | null; integrationMethod: string; pollIntervalSec: number; assignedCollectorId: string | null; hasCredentials: boolean; networkId: string; lastPolledAt: string | null; lastSeenAt: string | null; capabilities: Cap[]; network: { name: string; cidr: string }; collector: { name: string; status: string } | null }

const TABS = ["Overview", "Connected Devices", "Interfaces", "Metrics", "Configuration", "Events"] as const;

export function RouterDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["router", id], queryFn: () => api<Detail>(`/routers/${id}`) });
  const test = useMutation({ mutationFn: () => api<{ status: string; error?: string }>(`/routers/${id}/test`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["router", id] }) });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!q.data) return <p className="text-sm text-destructive">{(q.error as Error | null)?.message ?? "Not found"}</p>;
  const r = q.data.data;
  return (
    <div className="space-y-4">
      <Link href="/routers" className="text-xs text-muted-foreground hover:text-foreground">← Routers</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{r.name}</h1><StatusDot status={r.status} /><IntegrationBadge status={r.integrationStatus} />
        <button onClick={() => test.mutate()} disabled={test.isPending} className="ml-auto rounded-md border px-3 py-1.5 text-sm disabled:opacity-50">{test.isPending ? "Testing…" : "Test connection"}</button>
      </div>
      {(r.integrationError || test.data?.data.error) && <p className="rounded-md border border-warning/40 p-2 text-xs text-warning">{test.data?.data.error ?? r.integrationError}</p>}
      {test.error && <p className="text-xs text-destructive">{(test.error as Error).message}</p>}
      <div className="flex gap-1 border-b">{TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={cn("px-3 py-2 text-sm text-muted-foreground", tab === t && "border-b-2 border-primary text-foreground")}>{t}</button>)}</div>
      {tab === "Overview" && <Overview r={r} />}
      {tab === "Connected Devices" && <Clients id={id} supported={r.capabilities.find((c) => c.capability === "connectedClients")?.state === "SUPPORTED"} />}
      {tab === "Interfaces" && <Interfaces id={id} supported={r.capabilities.find((c) => c.capability === "interfaces")?.state === "SUPPORTED"} />}
      {tab === "Metrics" && <Metrics id={id} />}
      {tab === "Configuration" && <RouterForm initial={r} />}
      {tab === "Events" && <Events id={id} />}
    </div>
  );
}

function Overview({ r }: { r: Detail }) {
  const rows: [string, string | null][] = [["Manufacturer", r.manufacturer], ["Model", r.model], ["Firmware", r.firmware], ["Management IP", r.managementIp], ["LAN IP", r.lanIp], ["WAN IP", r.wanIp], ["Uptime", r.uptimeSec === null ? null : formatUptime(r.uptimeSec)], ["LAN subnet", `${r.network.name} (${r.network.cidr})`], ["Collector", r.collector?.name ?? null], ["Method", r.integrationMethod], ["Last polled", ago(r.lastPolledAt)], ["Last seen", ago(r.lastSeenAt)]];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel space-y-1.5 p-4 text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span>{v ?? <span className="text-muted-foreground">unavailable</span>}</span></div>)}</div>
      <div className="panel p-4 text-sm">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Capabilities (as detected)</h2>
        {r.capabilities.length === 0 ? <p className="text-xs text-muted-foreground">Not tested yet. Use “Test connection”.</p> :
          r.capabilities.map((c) => <div key={c.capability} className="flex items-start justify-between gap-2 border-b py-1.5 last:border-0">
            <span>{CAP_LABEL[c.capability] ?? c.capability}</span>
            <span className="text-right text-xs"><span className={c.state === "SUPPORTED" ? "text-success" : c.state === "ERROR" ? "text-destructive" : "text-muted-foreground"}>{c.state.toLowerCase()}</span>{c.detail && <div className="text-muted-foreground">{c.detail}</div>}</span>
          </div>)}
      </div>
    </div>
  );
}
function Unsupported({ what }: { what: string }) { return <p className="panel p-6 text-center text-sm text-muted-foreground">{what} is not available from this router's integration.</p>; }
function Clients({ id, supported }: { id: string; supported: boolean }) {
  const q = useQuery({ queryKey: ["router", id, "clients"], queryFn: () => api<{ mac: string; ip: string; hostname: string | null; since: string; device: { id: string; displayName: string | null } | null }[]>(`/routers/${id}/clients`), enabled: supported });
  if (!supported) return <Unsupported what="Connected-client information" />;
  return <Table head={["Device", "IP", "MAC", "Hostname", "Since"]} rows={(q.data?.data ?? []).map((c) => [c.device ? <Link key="d" href={`/devices/${c.device.id}`} className="hover:text-primary">{c.device.displayName ?? "Inventory device"}</Link> : "Not in inventory", c.ip, c.mac, c.hostname ?? "—", ago(c.since)])} />;
}
function Interfaces({ id, supported }: { id: string; supported: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["router", id, "ifaces"], queryFn: () => api<{ id: string; name: string; role: string; macAddress: string | null; speedMbps: number | null; isUp: boolean | null; rxBps: number | null; txBps: number | null; errors: number | null }[]>(`/routers/${id}/interfaces`), enabled: supported });
  const setRole = useMutation({ mutationFn: (v: { ifId: string; role: string }) => api(`/routers/${id}/interfaces/${v.ifId}`, { method: "PATCH", body: JSON.stringify({ role: v.role }) }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["router", id, "ifaces"] }); void qc.invalidateQueries({ queryKey: ["traffic"] }); } });
  if (!supported) return <Unsupported what="Interface information" />;
  const bps = (v: number | null) => (v === null ? "—" : v > 1e6 ? `${(v / 1e6).toFixed(1)} Mb/s` : `${(v / 1e3).toFixed(0)} kb/s`);
  return <><p className="mb-2 text-xs text-muted-foreground">Role decides how traffic is counted: only WAN interfaces count toward Internet totals. New samples use the new role.</p><Table head={["Interface", "Role", "MAC", "Speed", "State", "RX", "TX", "Errors"]} rows={(q.data?.data ?? []).map((i) => [i.name,
    <select key="r" aria-label={`Role of ${i.name}`} value={i.role} disabled={setRole.isPending} onChange={(e) => setRole.mutate({ ifId: i.id, role: e.target.value })} className="rounded border bg-card px-1 py-0.5 text-xs">{["WAN", "LAN", "OTHER"].map((r) => <option key={r}>{r}</option>)}</select>,
    i.macAddress ?? "—", i.speedMbps ? `${i.speedMbps} Mb/s` : "—", i.isUp === null ? "—" : i.isUp ? "up" : "down", bps(i.rxBps), bps(i.txBps), i.errors ?? "—"])} />{setRole.error && <p className="mt-2 text-xs text-destructive">{String(setRole.error.message)}</p>}</>;
}
function Metrics({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["router", id, "metrics"], queryFn: () => api<{ timestamp: string; latencyMs: number | null; reachable: boolean }[]>(`/routers/${id}/metrics`) });
  const data = (q.data?.data ?? []).map((m) => ({ t: new Date(m.timestamp).toLocaleTimeString(), latency: m.reachable ? m.latencyMs : null }));
  if (!data.length) return <p className="panel p-6 text-center text-sm text-muted-foreground">No polls recorded yet.</p>;
  return <div className="panel h-64 p-4"><ResponsiveContainer><LineChart data={data}><XAxis dataKey="t" fontSize={10} /><YAxis fontSize={10} unit="ms" /><Tooltip /><Line dataKey="latency" stroke="var(--primary)" dot={false} connectNulls={false} /></LineChart></ResponsiveContainer></div>;
}
function Events({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["router", id, "events"], queryFn: () => api<{ id: string; message: string; severity: string; occurredAt: string }[]>(`/routers/${id}/events`) });
  const rows = q.data?.data ?? [];
  if (!rows.length) return <p className="panel p-6 text-center text-sm text-muted-foreground">No events for this router.</p>;
  return <Table head={["When", "Severity", "Event"]} rows={rows.map((e) => [ago(e.occurredAt), e.severity.toLowerCase(), e.message])} />;
}
function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="panel p-6 text-center text-sm text-muted-foreground">Nothing reported yet.</p>;
  return <div className="panel overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><tr>{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-b last:border-0">{r.map((c, j) => <td key={j} className="px-3 py-2 text-xs">{c}</td>)}</tr>)}</tbody></table></div>;
}
