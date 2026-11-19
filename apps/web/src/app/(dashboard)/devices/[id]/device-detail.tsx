"use client";
import Link from "next/link";
import { Children, useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { StatusDot, ago } from "@/components/status-dot";
import { ChartPanel, RangeToggle, TimeChart, ms, pct } from "@/components/charts";
import { cn } from "@/lib/utils";
import type { DeviceTraffic } from "@/services/traffic";
import { TrafficRangeToggle } from "@/components/traffic-range";
import { bps, bytes, type TrafficRangeValue } from "@/components/traffic-format";

export interface Device { id: string; displayName: string | null; hostname: string | null; vendor: string | null; deviceType: string | null; category: string | null; notes: string | null; status: string; icmpBlocked: boolean; consecutiveFailures: number; firstSeenAt: string; lastSeenAt: string | null; lastSuccessfulAt: string | null; network: { name: string; cidr: string }; identifiers: { id: string; type: string; value: string; confidence: number; firstSeenAt: string; lastSeenAt: string }[]; addresses: { address: string }[]; mergedFrom: { id: string; displayName: string | null; hostname: string | null }[] }
interface History { addresses: { id: string; address: string; validFrom: string; validTo: string | null }[]; transitions: { id: string; fromStatus: string; toStatus: string; reason: string | null; occurredAt: string }[]; events: { id: string; type: string; severity: string; message: string; occurredAt: string }[]; observations: { id: string; method: string; source: string; ipAddress: string | null; macAddress: string | null; hostname: string | null; reachable: boolean; latencyMs: number | null; observedAt: string; collectorName: string | null }[] }
interface Metrics { range: string; availability: number | null; samples: number; series: { t: string; avg: number | null; min: number | null; max: number | null; loss: number | null; availability: number | null }[]; recent: { id: string; measuredAt: string; minMs: number | null; avgMs: number | null; maxMs: number | null; packetLoss: number; sent: number; received: number; targetIp: string; collector: { name: string } }[] }

const CATEGORIES = ["Computer", "Phone", "Tablet", "TV / Media", "IoT", "Network", "Printer", "Server", "Camera", "Other"];
const TABS = ["Overview", "History", "Metrics", "Traffic", "Information"] as const;
type Tab = (typeof TABS)[number];

export function DeviceDetail({ id, initial }: { id: string; initial: Device }) {
  const dev = useQuery({ queryKey: ["device", id], queryFn: async () => (await api<Device>(`/devices/${id}`)).data, initialData: initial });
  const [tab, setTab] = useState<Tab>("Overview");
  const d = dev.data;
  return (
    <div className="space-y-4">
      <Link href="/devices" className="text-xs text-muted-foreground hover:text-foreground">← Devices</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold">{d.displayName ?? d.hostname ?? "Unnamed device"}</h1><StatusDot status={d.status} /><span className="text-xs text-muted-foreground">last seen {ago(d.lastSeenAt)}</span></div>
      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{t}</button>)}
      </div>
      {tab === "Overview" && <OverviewTab d={d} />}
      {tab === "History" && <HistoryTab id={id} />}
      {tab === "Metrics" && <MetricsTab id={id} icmpBlocked={d.icmpBlocked} />}
      {tab === "Traffic" && <TrafficTab id={id} />}
      {tab === "Information" && <InfoTab d={d} />}
    </div>
  );
}

function OverviewTab({ d }: { d: Device }) {
  const mac = d.identifiers.filter((i) => i.type === "MAC");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel space-y-2 p-4 text-sm">
        <H>Identity &amp; status</H>
        <Field k="Name" v={d.displayName} /><Field k="Hostname" v={d.hostname} /><Field k="Manufacturer" v={d.vendor} />
        <Field k="Status" v={d.status.toLowerCase()} /><Field k="Failed checks in a row" v={String(d.consecutiveFailures)} />
        <Field k="Network" v={`${d.network.name} (${d.network.cidr})`} />
        <Field k="First seen" v={new Date(d.firstSeenAt).toLocaleString()} /><Field k="Last seen" v={d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : null} />
        {d.icmpBlocked && <p className="text-xs text-warning">This device blocks ping — availability is inferred from ARP, and ping loss alone never marks it offline.</p>}
      </div>
      <div className="panel space-y-2 p-4 text-sm">
        <H>Addresses</H>
        <Field k="Current IP" v={d.addresses.map((a) => a.address).join(", ") || null} mono />
        {mac.length ? mac.map((m) => <Field key={m.id} k="MAC" v={`${m.value}${m.confidence < 100 ? " (randomized?)" : ""}`} mono />) : <Field k="MAC" v={null} />}
      </div>
    </div>
  );
}

function HistoryTab({ id }: { id: string }) {
  const h = useQuery({ queryKey: ["device", id, "history"], queryFn: async () => (await api<History>(`/devices/${id}/history`)).data });
  if (h.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (h.error || !h.data) return <p className="text-sm text-destructive">{(h.error as Error | null)?.message ?? "Unavailable"}</p>;
  const x = h.data;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <List title="Online / offline transitions" empty="No transitions recorded">
        {x.transitions.map((t) => <div key={t.id} className="py-1.5 text-xs"><span className="text-muted-foreground">{t.fromStatus.toLowerCase()} → </span><StatusDot status={t.toStatus} /><div className="text-muted-foreground">{new Date(t.occurredAt).toLocaleString()} · {t.reason}</div></div>)}
      </List>
      <List title="IP address changes" empty="No addresses recorded">
        {x.addresses.map((a) => <div key={a.id} className="flex justify-between py-1.5 font-mono text-xs"><span>{a.address}</span><span className="text-muted-foreground">{new Date(a.validFrom).toLocaleString()} → {a.validTo ? new Date(a.validTo).toLocaleString() : "now"}</span></div>)}
      </List>
      <List title="Discovery &amp; device events" empty="No events recorded">
        {x.events.map((e) => <div key={e.id} className="py-1.5 text-xs"><div>{e.message}</div><div className="text-muted-foreground">{e.type} · {new Date(e.occurredAt).toLocaleString()}</div></div>)}
      </List>
    </div>
  );
}

function MetricsTab({ id, icmpBlocked }: { id: string; icmpBlocked: boolean }) {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const m = useQuery({ queryKey: ["device", id, "metrics", range], queryFn: async () => (await api<Metrics>(`/devices/${id}/metrics?range=${range}`)).data, placeholderData: keepPreviousData });
  const x = m.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Measured by the collector with ICMP echo. {icmpBlocked && "This device blocks ping, so loss here is expected."}</p>
        <RangeToggle value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Availability" v={x?.availability == null ? null : pct(x.availability)} note={x?.samples ? `${x.samples} probes` : "No probes in range"} />
        <Stat label="Latest avg latency" v={x?.recent[0]?.avgMs == null ? null : ms(x.recent[0].avgMs)} note={x?.recent[0] ? ago(x.recent[0].measuredAt) : "—"} />
        <Stat label="Latest packet loss" v={x?.recent[0] ? pct(x.recent[0].packetLoss) : null} note={x?.recent[0] ? `${x.recent[0].received}/${x.recent[0].sent} replies` : "—"} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartPanel title="Latency" empty={!x?.series.some((s) => s.avg !== null)}>
          <TimeChart data={x?.series ?? []} range={range} series={[{ key: "min", label: "Min", color: "var(--success)", format: ms }, { key: "avg", label: "Average", color: "var(--primary)", format: ms }, { key: "max", label: "Max", color: "var(--warning)", format: ms }]} />
        </ChartPanel>
        <ChartPanel title="Packet loss" empty={!x?.series.some((s) => s.loss !== null)}>
          <TimeChart data={x?.series ?? []} range={range} area yDomain={[0, 1]} series={[{ key: "loss", label: "Loss", color: "var(--destructive)", format: pct }]} />
        </ChartPanel>
        <ChartPanel title="Availability" empty={!x?.series.some((s) => s.availability !== null)}>
          <TimeChart data={x?.series ?? []} range={range} area yDomain={[0, 1]} series={[{ key: "availability", label: "Availability", color: "var(--success)", format: pct }]} />
        </ChartPanel>
        <List title="Latest probe rounds" empty="No measurements yet">
          {(x?.recent ?? []).map((r) => <div key={r.id} className="grid grid-cols-4 py-1 font-mono text-xs"><span className="text-muted-foreground">{new Date(r.measuredAt).toLocaleTimeString()}</span><span>{r.avgMs == null ? "—" : ms(r.avgMs)}</span><span>{pct(r.packetLoss)} loss</span><span className="truncate text-muted-foreground">{r.collector.name}</span></div>)}
        </List>
      </div>
    </div>
  );
}

function InfoTab({ d }: { d: Device }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ displayName: d.displayName ?? "", category: d.category ?? "", notes: d.notes ?? "" });
  const [mergeId, setMergeId] = useState("");
  useEffect(() => { setForm({ displayName: d.displayName ?? "", category: d.category ?? "", notes: d.notes ?? "" }); }, [d.displayName, d.category, d.notes]);
  const h = useQuery({ queryKey: ["device", d.id, "history"], queryFn: async () => (await api<History>(`/devices/${d.id}/history`)).data });
  const save = useMutation({
    mutationFn: () => api(`/devices/${d.id}`, { method: "PATCH", body: JSON.stringify({ displayName: form.displayName || null, category: form.category || null, notes: form.notes || null }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["device", d.id] }); void qc.invalidateQueries({ queryKey: ["devices"] }); },
  });
  const merge = useMutation({
    mutationFn: () => api(`/devices/${d.id}/merge`, { method: "POST", body: JSON.stringify({ sourceDeviceId: mergeId.trim() }) }),
    onSuccess: () => { setMergeId(""); void qc.invalidateQueries(); },
  });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="panel space-y-3 p-4 text-sm">
        <H>Notes &amp; category</H>
        <label className="block"><span className="text-xs text-muted-foreground">Name</span><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={100} className="mt-1 w-full rounded-md border bg-background px-3 py-1.5" /></label>
        <label className="block"><span className="text-xs text-muted-foreground">Category</span>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5"><option value="">Uncategorized</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="block"><span className="text-xs text-muted-foreground">Notes</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} maxLength={2000} className="mt-1 w-full rounded-md border bg-background px-3 py-1.5" /></label>
        <button disabled={save.isPending} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-60">{save.isPending ? "Saving…" : "Save"}</button>
        {save.isSuccess && <span className="ml-2 text-xs text-success">Saved</span>}
        {save.error && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
        <div className="border-t pt-3">
          <span className="text-xs text-muted-foreground">Merge another device into this one (paste its ID)</span>
          <div className="mt-1 flex gap-2"><input value={mergeId} onChange={(e) => setMergeId(e.target.value)} className="flex-1 rounded-md border bg-background px-2 py-1.5 font-mono text-xs" /><button type="button" disabled={!mergeId || merge.isPending} onClick={() => merge.mutate()} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Merge</button></div>
          {merge.error && <p className="mt-1 text-xs text-destructive">{(merge.error as Error).message}</p>}
        </div>
      </form>
      <List title="Identification history" empty="No identifiers">
        {d.identifiers.map((i) => <div key={i.id} className="py-1.5 text-xs"><div className="flex justify-between font-mono"><span>{i.type}</span><span>{i.value}</span></div><div className="text-muted-foreground">confidence {i.confidence}% · first {new Date(i.firstSeenAt).toLocaleDateString()} · last {ago(i.lastSeenAt)}</div></div>)}
        {d.mergedFrom.map((m) => <div key={m.id} className="py-1.5 text-xs text-muted-foreground">Merged from {m.displayName ?? m.hostname ?? m.id}</div>)}
      </List>
      <List title="Collector observations" empty="No observations yet">
        {(h.data?.observations ?? []).map((o) => <div key={o.id} className="py-1.5 text-xs"><div className="flex justify-between"><span>{o.method} · {o.collectorName ?? "collector"}</span><span className={o.reachable ? "text-success" : "text-destructive"}>{o.reachable ? "reachable" : "no reply"}</span></div><div className="font-mono text-muted-foreground">{o.ipAddress ?? "—"} {o.macAddress ?? ""} · {new Date(o.observedAt).toLocaleString()}</div></div>)}
      </List>
    </div>
  );
}

function TrafficTab({ id }: { id: string }) {
  const [range, setRange] = useState<TrafficRangeValue>("24h");
  const q = useQuery({ queryKey: ["device", id, "traffic", range], queryFn: async () => (await api<DeviceTraffic>(`/devices/${id}/traffic?range=${range}`)).data, placeholderData: keepPreviousData });
  const t = q.data;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><TrafficRangeToggle value={range} onChange={setRange} /><span className="text-xs text-muted-foreground">Last updated {ago(t?.lastUpdated)}</span></div>
      {t && !t.available && <div className="panel p-4 text-sm"><span className="font-medium">Traffic unavailable for this device.</span> <span className="text-muted-foreground">{t.unavailableReason}</span></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Download" v={t?.usage ? bytes(t.usage.download) : null} note={t?.usage ? "in selected period" : "not measured"} />
        <Stat label="Upload" v={t?.usage ? bytes(t.usage.upload) : null} note={t?.usage ? "in selected period" : "not measured"} />
        <Stat label="Total" v={t?.usage ? bytes(t.usage.total) : null} note={t?.usage ? "in selected period" : "not measured"} />
        <Stat label="Current speed" v={t?.current ? `↓ ${bps(t.current.downloadBps)}` : null} note={t?.current ? `↑ ${bps(t.current.uploadBps)} · ${ago(t.current.measuredAt)}` : "no sample in the last 10 minutes"} />
      </div>
      <ChartPanel title={`Historical usage${t?.source ? ` · ${t.source.name}` : ""}`} empty={!t?.available}>
        <TimeChart data={t?.series ?? []} range={range} area series={[{ key: "down", label: "Download", color: "var(--primary)", format: bps }, { key: "up", label: "Upload", color: "var(--success)", format: bps }]} />
      </ChartPanel>
      <div className="panel p-4 text-sm"><H>Data source</H>
        <p className="mt-1">{t?.source ? `${t.source.name} (${t.source.kind.replaceAll("_", " ").toLowerCase()})` : "None"}</p>
        {!!t?.otherSources.length && <p className="mt-1 text-xs text-muted-foreground">Also measured by: {t.otherSources.map((o) => `${o.source?.name ?? "unknown"} (↓ ${bytes(o.download)} ↑ ${bytes(o.upload)})`).join("; ")}. Sources are shown separately, never added together.</p>}
      </div>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-xs uppercase tracking-wider text-muted-foreground">{children}</h2>;
function List({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Children.toArray(children);
  return <div className="panel p-4"><H>{title}</H>{items.length ? <div className="mt-1 max-h-96 divide-y overflow-y-auto">{items}</div> : <p className="py-4 text-sm text-muted-foreground">{empty}</p>}</div>;
}
function Stat({ label, v, note }: { label: string; v: string | null; note: string }) {
  return <div className="panel p-3"><div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 font-mono text-lg">{v ?? <span className="text-muted-foreground">—</span>}</div><div className="text-[11px] text-muted-foreground">{note}</div></div>;
}
function Field({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return <div className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className={mono ? "font-mono text-xs" : ""}>{v ?? "—"}</span></div>;
}
