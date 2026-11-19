"use client";
import Link from "next/link";
import { Children, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bell, RadioTower, ScrollText } from "lucide-react";
import { api } from "@/lib/fetcher";
import type { Charts, Dashboard } from "@/services/dashboard";
import { PageHeader } from "@/components/empty-state";
import { StatusDot, ago } from "@/components/status-dot";
import { ChartPanel, RangeToggle, TimeChart, ms, pct } from "@/components/charts";
import { cn } from "@/lib/utils";

const C = { primary: "var(--primary)", success: "var(--success)", warning: "var(--warning)", destructive: "var(--destructive)", muted: "var(--muted-foreground)" };

export function DashboardView({ initial, initialCharts }: { initial: Dashboard; initialCharts: Charts }) {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  // No refetchInterval: these refresh only when the realtime gateway reports a change.
  const { data: d } = useQuery({ queryKey: ["dashboard"], queryFn: async () => (await api<Dashboard>("/dashboard")).data, initialData: initial, staleTime: 30_000 });
  const charts = useQuery({ queryKey: ["dashboard", "charts", range], queryFn: async () => (await api<Charts>(`/dashboard/charts?range=${range}`)).data, initialData: range === "24h" ? initialCharts : undefined, placeholderData: keepPreviousData, staleTime: 60_000 });
  const s = d.summary, h = d.health;
  const noCollectors = d.collectors.length === 0;
  const ch = charts.data;

  return (
    <>
      <PageHeader title="Overview" description="Live health of your monitored networks, calculated from collector and router records." />

      <section aria-label="Network summary" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Total devices" value={s.total} />
        <Tile label="Online" value={s.online} tone="success" />
        <Tile label="Offline" value={s.offline} tone={s.offline ? "destructive" : undefined} />
        <Tile label="Unknown" value={s.unknown} note="Not yet confirmed" />
        <Tile label="Active routers" value={s.activeRouters} note={`of ${s.routersTotal}`} />
        <Tile label="Networks" value={s.networks} />
        <Tile label="Collectors up" value={s.collectorsConnected} tone="success" />
        <Tile label="Collectors down" value={s.collectorsDisconnected} tone={s.collectorsDisconnected ? "destructive" : undefined} />
      </section>

      <section aria-label="Network health" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Health score" text={h.healthScore === null ? null : `${h.healthScore}`} note={h.healthAt ? `Snapshot ${ago(h.healthAt)}` : "Waiting for first snapshot"} />
        <Tile label="Avg latency" text={h.avgLatencyMs === null ? null : ms(h.avgLatencyMs)} note={h.measurements15m ? `${h.measurements15m} probes, last 15 min` : "No probes in last 15 min"} />
        <Tile label="Packet loss" text={h.packetLoss === null ? null : pct(h.packetLoss)} note="Last 15 min" />
        <Tile label="Router availability" text={h.routerAvailability === null ? null : pct(h.routerAvailability)} note={s.routersTotal ? "Now" : "No routers"} />
        <Tile label="Collector availability" text={h.collectorAvailability === null ? null : pct(h.collectorAvailability)} note={noCollectors ? "No collectors" : "Now"} />
      </section>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="text-sm font-medium">History</h2>
        <RangeToggle value={range} onChange={setRange} />
      </div>
      <section className={cn("grid gap-3 lg:grid-cols-2", charts.isFetching && "opacity-70")}>
        <ChartPanel title="Device availability" empty={!ch?.health.some((x) => x.availability !== null)}>
          <TimeChart data={ch?.health ?? []} range={range} area yDomain={[0, 1]} series={[{ key: "availability", label: "Availability", color: C.success, format: pct }]} />
        </ChartPanel>
        <ChartPanel title="Latency (collector ICMP)" empty={!ch?.latency.some((x) => x.avg !== null)}>
          <TimeChart data={ch?.latency ?? []} range={range} series={[{ key: "avg", label: "Average", color: C.primary, format: ms }, { key: "max", label: "Max", color: C.warning, format: ms }]} />
        </ChartPanel>
        <ChartPanel title="Device count" empty={!ch?.health.length}>
          <TimeChart data={ch?.health ?? []} range={range} series={[{ key: "total", label: "Total", color: C.muted }, { key: "online", label: "Online", color: C.success }, { key: "offline", label: "Offline", color: C.destructive }]} />
        </ChartPanel>
        <ChartPanel title="Network health score" empty={!ch?.health.some((x) => x.health !== null)}>
          <TimeChart data={ch?.health ?? []} range={range} area yDomain={[0, 100]} series={[{ key: "health", label: "Health", color: C.primary, format: (v) => v.toFixed(0) }]} />
        </ChartPanel>
        <ChartPanel title="Router availability" empty={!ch?.health.some((x) => x.routerAvailability !== null)}>
          <TimeChart data={ch?.health ?? []} range={range} area yDomain={[0, 1]} series={[{ key: "routerAvailability", label: "Routers up", color: C.success, format: pct }]} />
        </ChartPanel>
        <ChartPanel title="Packet loss" empty={!ch?.latency.some((x) => x.loss !== null)}>
          <TimeChart data={ch?.latency ?? []} range={range} area yDomain={[0, 1]} series={[{ key: "loss", label: "Loss", color: C.destructive, format: pct }]} />
        </ChartPanel>
      </section>

      <h2 className="mb-2 mt-6 text-sm font-medium">Recent activity</h2>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Feed title="Recently discovered" empty="No devices discovered yet">
          {d.recent.discovered.map((x) => <Row key={x.id} href={`/devices/${x.id}`} main={x.displayName ?? x.hostname ?? x.vendor ?? "Unnamed device"} sub={`${x.network.name} · ${ago(x.firstSeenAt)}`} />)}
        </Feed>
        <Feed title="Recently disconnected" empty="No devices have gone offline">
          {d.recent.disconnected.map((x) => <Row key={x.id} href={`/devices/${x.device.id}`} main={x.device.displayName ?? x.device.hostname ?? "Unnamed device"} sub={`${ago(x.occurredAt)} · ${x.reason ?? ""}`} />)}
        </Feed>
        <Feed title="Router events" empty="No router events yet">
          {d.recent.routerEvents.map((e) => <Row key={e.id} main={e.message} sub={ago(e.occurredAt)} sev={e.severity} />)}
        </Feed>
        <Feed title="Recent alerts" empty="No alerts. Alert rules arrive in a later phase." icon={Bell}>
          {d.recent.alerts.map((a) => <Row key={a.id} main={a.title} sub={`${a.state.toLowerCase()} · ${ago(a.triggeredAt)}`} sev={a.severity} />)}
        </Feed>
        <Feed title="Network changes" empty="No scans or collector changes yet" icon={ScrollText}>
          {d.recent.networkChanges.map((e) => <Row key={e.id} main={e.message} sub={ago(e.occurredAt)} sev={e.severity} />)}
        </Feed>
        <Feed title="Collectors" empty="No collectors registered. Create one and start it on your network." icon={RadioTower}>
          {d.collectors.map((c) => <div key={c.id} className="flex items-center justify-between py-1.5 text-sm"><span>{c.name}</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{ago(c.lastSeenAt)}<StatusDot status={c.status} /></span></div>)}
        </Feed>
      </section>
      <p className="mt-4 text-right text-xs"><Link href="/events" className="text-muted-foreground hover:text-foreground">All events →</Link></p>
    </>
  );
}

function Tile({ label, value, text, note, tone }: { label: string; value?: number; text?: string | null; note?: string; tone?: "success" | "destructive" }) {
  const shown = value !== undefined ? String(value) : text;
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1.5 font-mono text-xl", tone === "success" && "text-success", tone === "destructive" && "text-destructive")}>{shown ?? <span className="text-muted-foreground">—</span>}</div>
      {note && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}
function Feed({ title, empty, children, icon: Icon }: { title: string; empty: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="panel p-4">
      <h3 className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{title}</h3>
      {Children.count(children) ? <div className="divide-y">{children}</div> : <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">{Icon && <Icon className="h-4 w-4" />}{empty}</p>}
    </div>
  );
}
function Row({ main, sub, href, sev }: { main: string; sub: string; href?: string; sev?: string }) {
  const body = <><span className="flex items-center gap-2 truncate">{sev && <Sev s={sev} />}{main}</span><span className="block truncate text-xs text-muted-foreground">{sub}</span></>;
  return href ? <Link href={href} className="block py-1.5 text-sm hover:text-primary">{body}</Link> : <div className="py-1.5 text-sm">{body}</div>;
}
export function Sev({ s }: { s: string }) {
  return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s === "CRITICAL" ? "bg-destructive" : s === "WARNING" ? "bg-warning" : "bg-muted-foreground")} aria-label={s.toLowerCase()} />;
}
