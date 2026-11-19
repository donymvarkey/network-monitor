"use client";
import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import type { Traffic } from "@/services/traffic";
import { PageHeader } from "@/components/empty-state";
import { ago } from "@/components/status-dot";
import { ChartPanel, TimeChart } from "@/components/charts";
import { TrafficRangeToggle } from "@/components/traffic-range";
import { bps, bytes, type TrafficRangeValue } from "@/components/traffic-format";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = { ACTIVE: "text-success", STALE: "text-warning", ERROR: "text-destructive", UNSUPPORTED: "text-muted-foreground", DISABLED: "text-muted-foreground" };

export function TrafficView({ initial, networks }: { initial: Traffic; networks: { id: string; name: string; cidr: string }[] }) {
  const [range, setRange] = useState<TrafficRangeValue>("24h");
  const [networkId, setNetworkId] = useState("");
  const isInitial = range === "24h" && !networkId;
  const { data: t, isFetching } = useQuery({
    queryKey: ["traffic", range, networkId], placeholderData: keepPreviousData, staleTime: 30_000,
    queryFn: async () => (await api<Traffic>(`/traffic?range=${range}${networkId ? `&networkId=${networkId}` : ""}`)).data,
    initialData: isInitial ? initial : undefined,
  });
  const d = t ?? initial;
  const noWan = d.totals.wanSamples === 0;
  const noDevice = d.totals.deviceSamples === 0;
  const wanReason = "No router WAN-interface counters in this period. Add a router with SNMP, or check that one interface is marked as WAN.";
  const deviceReason = "No per-device source reported traffic in this period. ARP/ICMP discovery cannot measure bandwidth.";

  return (
    <>
      <PageHeader title="Traffic Analytics" description="Measured traffic only. “Unavailable” means nothing measured it — it is not the same as zero." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TrafficRangeToggle value={range} onChange={setRange} />
        <select aria-label="Filter by network" value={networkId} onChange={(e) => setNetworkId(e.target.value)} className="rounded-md border bg-card px-2 py-1.5 text-sm">
          <option value="">All networks</option>
          {networks.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.cidr})</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{isFetching ? "Updating…" : `Last updated ${ago(d.lastUpdated)}`}</span>
      </div>

      <section aria-label="Traffic summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total download" value={bytes(d.totals.download)} na={d.totals.download === null} note={noWan ? wanReason : "Router WAN counters"} />
        <Tile label="Total upload" value={bytes(d.totals.upload)} na={d.totals.upload === null} note={noWan ? wanReason : "Router WAN counters"} />
        <Tile label="Current download" value={bps(d.current.downloadBps)} na={d.current.downloadBps === null} note={d.current.downloadBps === null ? "No WAN sample in the last 10 minutes" : `Latest sample, ${d.current.interfaces} WAN interface(s)`} />
        <Tile label="Current upload" value={bps(d.current.uploadBps)} na={d.current.uploadBps === null} note={d.current.uploadBps === null ? "No WAN sample in the last 10 minutes" : `Latest sample, ${d.current.interfaces} WAN interface(s)`} />
      </section>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <ChartPanel title="Internet traffic (router WAN)" empty={noWan}>
          <TimeChart data={d.series} range={range} area series={[{ key: "down", label: "Download", color: "var(--primary)", format: bps }, { key: "up", label: "Upload", color: "var(--success)", format: bps }]} />
        </ChartPanel>
        <ChartPanel title="Measured per-device traffic (all devices)" empty={noDevice}>
          <TimeChart data={d.series} range={range} area series={[{ key: "devDown", label: "Download", color: "var(--primary)", format: bps }, { key: "devUp", label: "Upload", color: "var(--success)", format: bps }]} />
        </ChartPanel>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Panel title="Top bandwidth consumers" className="lg:col-span-2">
          {d.top.length === 0 ? <Unavailable text={deviceReason} /> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1.5 font-normal">Device</th><th className="font-normal">Download</th><th className="font-normal">Upload</th><th className="font-normal">Total</th><th className="font-normal">Source</th></tr></thead>
              <tbody className="divide-y">
                {d.top.map((x) => (
                  <tr key={x.deviceId}>
                    <td className="py-1.5"><Link href={`/devices/${x.deviceId}`} className="hover:underline">{x.name}</Link><div className="text-[11px] text-muted-foreground">{x.network}</div></td>
                    <td className="font-mono text-xs">{bytes(x.download)}</td><td className="font-mono text-xs">{bytes(x.upload)}</td>
                    <td className="font-mono text-xs"><Bar v={x.total} max={d.top[0]!.total} label={bytes(x.total)} /></td>
                    <td className="text-xs text-muted-foreground">{x.source?.name ?? "—"}</td>
                  </tr>))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Traffic source status">
          <ul className="space-y-2 text-xs">
            {d.sources.kinds.map((k) => {
              const srcs = d.sources.sources.filter((s) => s.kind === k.kind);
              return (
                <li key={k.kind}>
                  <div className="flex justify-between gap-2"><span className="font-medium">{k.label}</span>
                    <span className={cn(srcs.length ? STATUS_TONE[srcs.some((s) => s.status === "ACTIVE") ? "ACTIVE" : srcs[0]!.status] : "text-muted-foreground")}>{srcs.length ? (srcs.some((s) => s.status === "ACTIVE") ? `${k.active} active` : srcs[0]!.status.toLowerCase()) : "not configured"}</span></div>
                  <div className="text-muted-foreground">{k.perDevice ? "Per-device" : "Per-interface only"} · {srcs.length ? srcs.map((s) => `${s.name} (${ago(s.lastSampleAt)}${s.detail ? `, ${s.detail}` : ""})`).join("; ") : k.howTo}</div>
                </li>);
            })}
          </ul>
          {d.sources.routers.length > 0 && (
            <div className="mt-3 border-t pt-2 text-xs">
              <div className="mb-1 text-muted-foreground">Router traffic capabilities</div>
              {d.sources.routers.map((r) => {
                const st = r.capabilities.find((c) => c.capability === "interfaceStats"), ct = r.capabilities.find((c) => c.capability === "clientTraffic");
                return <div key={r.id} className="flex justify-between gap-2"><Link href={`/routers/${r.id}`} className="hover:underline">{r.name}</Link><span className="text-muted-foreground">interfaces: {st?.state.toLowerCase() ?? "untested"} · per-client: {ct?.state.toLowerCase() ?? "untested"}</span></div>;
              })}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Panel title="Traffic by device">
          {d.byDevice.length === 0 ? <Unavailable text={deviceReason} /> : <Rows rows={d.byDevice.map((x) => ({ k: x.deviceId, name: x.name, href: `/devices/${x.deviceId}`, down: x.download, up: x.upload }))} />}
        </Panel>
        <Panel title="Traffic by network">
          {d.byNetwork.length === 0 ? <Unavailable text="No measured traffic attributed to a network in this period." /> : <Rows rows={d.byNetwork.map((x) => ({ k: x.networkId + x.perDevice, name: `${x.name}${x.perDevice ? " · sum of measured devices" : " · router WAN"}`, down: x.download, up: x.upload }))} />}
        </Panel>
        <Panel title="Traffic by router (WAN)">
          {d.byRouter.length === 0 ? <Unavailable text={wanReason} /> : <Rows rows={d.byRouter.map((x) => ({ k: x.routerId, name: x.name, href: `/routers/${x.routerId}`, down: x.download, up: x.upload }))} />}
        </Panel>
      </div>

      <Panel title="Router interfaces" className="mt-4">
        {d.interfaces.length === 0 ? <Unavailable text="No router has reported interfaces. Interface counters need SNMP." /> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1.5 font-normal">Router</th><th className="font-normal">Interface</th><th className="font-normal">Role</th><th className="font-normal">Down / in</th><th className="font-normal">Up / out</th><th className="font-normal">Utilisation</th><th className="font-normal">Sampled</th></tr></thead>
            <tbody className="divide-y">
              {d.interfaces.map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5 text-xs">{i.routerName}</td><td className="font-mono text-xs">{i.name}</td>
                  <td className="text-xs">{i.role}{i.role === "WAN" && <span className="text-muted-foreground"> · counts toward totals</span>}</td>
                  <td className="font-mono text-xs">{bps(i.downloadBps)}</td><td className="font-mono text-xs">{bps(i.uploadBps)}</td>
                  <td className="font-mono text-xs">{i.utilization === null ? (i.speedMbps ? "Unavailable" : "Unknown speed") : `${(i.utilization * 100).toFixed(1)}%`}</td>
                  <td className="text-xs text-muted-foreground">{ago(i.measuredAt)}</td>
                </tr>))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

function Tile({ label, value, note, na }: { label: string; value: string; note: string; na: boolean }) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-2 font-mono text-2xl", na && "text-base text-muted-foreground")}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}
function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={cn("panel p-4", className)}><h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{title}</h2>{children}</section>;
}
const Unavailable = ({ text }: { text: string }) => <p className="py-4 text-sm text-muted-foreground"><span className="font-medium text-foreground">Unavailable.</span> {text}</p>;
const Bar = ({ v, max, label }: { v: number; max: number; label: string }) => (
  <div className="flex items-center gap-2"><div className="h-1.5 w-16 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${max ? (v / max) * 100 : 0}%` }} /></div>{label}</div>
);
function Rows({ rows }: { rows: { k: string; name: string; href?: string; down: number; up: number }[] }) {
  return (
    <ul className="divide-y text-sm">
      {rows.slice(0, 15).map((r) => (
        <li key={r.k} className="flex items-center justify-between gap-2 py-1.5">
          {r.href ? <Link href={r.href} className="truncate hover:underline">{r.name}</Link> : <span className="truncate">{r.name}</span>}
          <span className="shrink-0 font-mono text-xs text-muted-foreground">↓ {bytes(r.down)} · ↑ {bytes(r.up)}</span>
        </li>))}
    </ul>
  );
}
