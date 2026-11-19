"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Router as RouterIcon } from "lucide-react";
import { api } from "@/lib/fetcher";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { StatusDot, ago } from "@/components/status-dot";
import { IntegrationBadge, formatUptime } from "@/components/integration-badge";
import { RouterForm } from "./router-form";

export interface RouterRow { id: string; name: string; manufacturer: string | null; model: string | null; firmware: string | null; managementIp: string | null; wanIp: string | null; wanUp: boolean | null; uptimeSec: number | null; status: string; integrationStatus: string; integrationMethod: string; lastPolledAt: string | null; network: { id: string; name: string; cidr: string }; collectorName: string | null }

export default function RoutersPage() {
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["routers"], queryFn: () => api<RouterRow[]>("/routers?pageSize=100"), refetchInterval: 30_000 });
  const rows = data?.data ?? [];
  return (
    <>
      <div className="flex items-start justify-between"><PageHeader title="Routers" description="Routers you have registered and what each integration can actually report." />
        <button onClick={() => setAdding((v) => !v)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">{adding ? "Cancel" : "Add router"}</button></div>
      {adding && <div className="mb-4"><RouterForm onDone={() => setAdding(false)} /></div>}
      {!isLoading && rows.length === 0 ? <EmptyState icon={RouterIcon} title="No routers registered" body="Add your main ISP router and any secondary routers to monitor their availability and supported details." /> : (
        <div className="panel overflow-x-auto"><table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><tr>{["Name", "Manufacturer / model", "Mgmt IP", "LAN subnet", "WAN", "Uptime", "Firmware", "Collector", "Status", "Integration"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-accent/50">
              <td className="px-3 py-2"><Link href={`/routers/${r.id}`} className="hover:text-primary">{r.name}</Link><div className="text-xs text-muted-foreground">polled {ago(r.lastPolledAt)}</div></td>
              <td className="px-3 py-2">{[r.manufacturer, r.model].filter(Boolean).join(" ") || "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.managementIp ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.network.cidr}</td>
              <td className="px-3 py-2 text-xs">{r.wanIp ? <span className="font-mono">{r.wanIp}</span> : r.wanUp === null ? <span className="text-muted-foreground">unavailable</span> : r.wanUp ? "up" : "down"}</td>
              <td className="px-3 py-2 text-xs">{formatUptime(r.uptimeSec)}</td>
              <td className="px-3 py-2 text-xs">{r.firmware ?? <span className="text-muted-foreground">unavailable</span>}</td>
              <td className="px-3 py-2 text-xs">{r.collectorName ?? "—"}</td>
              <td className="px-3 py-2"><StatusDot status={r.status} /></td>
              <td className="px-3 py-2"><IntegrationBadge status={r.integrationStatus} /></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
