"use client";
import { useQuery } from "@tanstack/react-query";
import { RadioTower } from "lucide-react";
import { api } from "@/lib/fetcher";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { StatusDot, ago } from "@/components/status-dot";
import { CollectorTokenActions } from "./token-actions";

interface Collector { id: string; name: string; hostname: string | null; status: string; version: string | null; lastSeenAt: string | null; lastScanAt: string | null; lastScanStatus: string | null; revokedAt: string | null; tokenRotatedAt: string | null; networks: { id: string; cidr: string }[] }

export default function CollectorsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["collectors"], queryFn: () => api<Collector[]>("/collectors"), refetchInterval: 30_000 });
  const rows = data?.data ?? [];
  return (
    <>
      <PageHeader title="Collectors" description="Linux agents that discover devices on their configured subnets." />
      {!isLoading && rows.length === 0 ? <EmptyState icon={RadioTower} title="No collectors" body="Create one with `pnpm --filter web collector:create <name>` and start it on your network." /> : (
        <div className="panel overflow-x-auto"><table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><tr>{["Name", "Collector ID", "Networks", "Status", "Last heartbeat", "Version", "Last scan", "Scan status", "Token"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="px-3 py-2">{c.name}{c.hostname && <div className="text-xs text-muted-foreground">{c.hostname}</div>}</td>
              <td className="px-3 py-2 font-mono text-xs">{c.id.slice(0, 8)}</td>
              <td className="px-3 py-2 font-mono text-xs">{c.networks.map((n) => n.cidr).join(", ") || "—"}</td>
              <td className="px-3 py-2"><StatusDot status={c.status} /></td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{ago(c.lastSeenAt)}</td>
              <td className="px-3 py-2 text-xs">{c.version ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{ago(c.lastScanAt)}</td>
              <td className="px-3 py-2">{c.lastScanStatus ? <StatusDot status={c.lastScanStatus} /> : "—"}</td>
              <td className="px-3 py-2"><CollectorTokenActions c={c} /></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
