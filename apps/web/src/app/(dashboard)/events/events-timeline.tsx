"use client";
import { Fragment, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, ScrollText } from "lucide-react";
import { api } from "@/lib/fetcher";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

interface Event { id: string; type: string; severity: string; message: string; data: unknown; occurredAt: string; device: { id: string; displayName: string | null; hostname: string | null } | null; network: { id: string; name: string } | null }
interface Opt { id: string; name: string }
const CATEGORIES = ["device", "router", "collector", "scan", "network", "alert"];
const FILTERS = ["q", "category", "severity", "deviceId", "routerId", "networkId", "collectorId", "from", "to"] as const;
const PAGE_SIZE = 50;

export function EventsTimeline() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const filters = Object.fromEntries(FILTERS.map((k) => [k, sp.get(k) ?? ""])) as Record<(typeof FILTERS)[number], string>;
  const [search, setSearch] = useState(filters.q);
  const [open, setOpen] = useState<string | null>(null);

  // Filters live in the URL so views are shareable and the back button works.
  const update = (patch: Partial<Record<string, string>>, resetPage = true) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (resetPage) next.delete("page");
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const apiQs = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of FILTERS) {
      const v = filters[k];
      if (!v) continue;
      p.set(k, k === "from" || k === "to" ? new Date(k === "to" && v.length === 10 ? `${v}T23:59:59` : v).toISOString() : v);
    }
    return p;
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const ev = useQuery({
    queryKey: ["events", apiQs.toString(), page],
    queryFn: () => api<Event[]>(`/events?${apiQs}&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const opts = useQuery({
    queryKey: ["events", "filter-options"], staleTime: 300_000,
    queryFn: async () => {
      const [d, r, n, c] = await Promise.all([
        api<{ id: string; displayName: string | null; hostname: string | null; vendor: string | null }[]>("/devices?pageSize=200&sort=name"),
        api<Opt[]>("/routers?pageSize=200"), api<Opt[]>("/networks?pageSize=200"), api<Opt[]>("/collectors"),
      ]);
      return { devices: d.data.map((x) => ({ id: x.id, name: x.displayName ?? x.hostname ?? x.vendor ?? x.id.slice(0, 8) })), routers: r.data, networks: n.data, collectors: c.data };
    },
  });

  const total = ev.data?.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const active = FILTERS.some((k) => filters[k]);

  return (
    <div className="space-y-3">
      <div className="panel grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <form className="lg:col-span-2" onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() }); }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages… (Enter)" aria-label="Search events" className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" />
        </form>
        <Select label="Category" value={filters.category} onChange={(v) => update({ category: v })} options={CATEGORIES.map((c) => ({ id: c, name: c }))} />
        <Select label="Severity" value={filters.severity} onChange={(v) => update({ severity: v })} options={["INFO", "WARNING", "CRITICAL"].map((s) => ({ id: s, name: s.toLowerCase() }))} />
        <Select label="Network" value={filters.networkId} onChange={(v) => update({ networkId: v })} options={opts.data?.networks ?? []} />
        <Select label="Device" value={filters.deviceId} onChange={(v) => update({ deviceId: v })} options={opts.data?.devices ?? []} />
        <Select label="Router" value={filters.routerId} onChange={(v) => update({ routerId: v })} options={opts.data?.routers ?? []} />
        <Select label="Collector" value={filters.collectorId} onChange={(v) => update({ collectorId: v })} options={opts.data?.collectors ?? []} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">From<input type="date" value={filters.from.slice(0, 10)} onChange={(e) => update({ from: e.target.value })} className="flex-1 rounded-md border bg-background px-2 py-1 text-sm text-foreground" /></label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">To<input type="date" value={filters.to.slice(0, 10)} onChange={(e) => update({ to: e.target.value })} className="flex-1 rounded-md border bg-background px-2 py-1 text-sm text-foreground" /></label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{ev.isLoading ? "Loading…" : `${total.toLocaleString()} event${total === 1 ? "" : "s"}`}{active && <button onClick={() => { setSearch(""); router.replace(path); }} className="ml-3 underline hover:text-foreground">Clear filters</button>}</span>
        <a href={`/api/v1/events/export?${apiQs}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 hover:text-foreground"><Download className="h-3.5 w-3.5" />Export CSV</a>
      </div>

      {ev.error ? <p className="text-sm text-destructive">{(ev.error as Error).message}</p>
        : !ev.isLoading && total === 0 ? <EmptyState icon={ScrollText} title={active ? "No events match these filters" : "No events recorded"} body={active ? "Try widening the date range or clearing a filter." : "Device, router and collector events will be listed here as they happen."} />
        : (
          <div className={cn("panel overflow-x-auto", ev.isFetching && "opacity-70")}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground"><tr className="border-b"><th className="px-3 py-2">Time</th><th className="px-3 py-2">Severity</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Message</th><th className="px-3 py-2">Network</th><th className="px-3 py-2">Device</th></tr></thead>
              <tbody>
                {(ev.data?.data ?? []).map((e) => (
                  <Fragment key={e.id}>
                    <tr onClick={() => setOpen(open === e.id ? null : e.id)} className="cursor-pointer border-b hover:bg-accent/50" aria-expanded={open === e.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">{new Date(e.occurredAt).toLocaleString()}</td>
                      <td className="px-3 py-2"><SevBadge s={e.severity} /></td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{e.type}</td>
                      <td className="px-3 py-2">{e.message}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{e.network?.name ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{e.device ? <a href={`/devices/${e.device.id}`} onClick={(x) => x.stopPropagation()} className="hover:text-primary">{e.device.displayName ?? e.device.hostname ?? "device"}</a> : "—"}</td>
                    </tr>
                    {open === e.id && <tr className="border-b bg-muted/40"><td colSpan={6} className="px-3 py-2"><pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{JSON.stringify({ id: e.id, type: e.type, occurredAt: e.occurredAt, data: e.data }, null, 2)}</pre></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)} className="rounded-md border px-2.5 py-1 disabled:opacity-40">Previous</button>
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, false)} className="rounded-md border px-2.5 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Opt[] }) {
  const all = { Category: "All categories", Severity: "All severities" }[label] ?? `All ${label.toLowerCase()}s`;
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm">
      <option value="">{all}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
function SevBadge({ s }: { s: string }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px]", s === "CRITICAL" ? "bg-destructive/20 text-destructive" : s === "WARNING" ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground")}>{s.toLowerCase()}</span>;
}
