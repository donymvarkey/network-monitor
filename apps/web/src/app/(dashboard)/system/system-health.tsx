"use client";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/fetcher";
import { StatusDot, ago } from "@/components/status-dot";

interface Check { status: string; detail?: string; hint?: string; latencyMs?: number; version?: string; [k: string]: unknown }
interface Health {
  checkedAt: string; services: Record<string, Check>;
  collectors: { id: string; name: string; status: string; lastSeenAt: string | null; lastSeenSecAgo: number | null; version: string | null; revokedAt: string | null }[];
  jobs: { queue: string; active: number; waiting: number; delayed: number; failed: number }[] | null;
  recentFailures: { id: string; queue: string; jobName: string; error: string; final: boolean; failedAt: string }[];
  backup: { lastSuccess: { fileName: string; sizeBytes: number | null; sha256: string | null; verified: boolean; finishedAt: string | null } | null; lastAttempt: { status: string; startedAt: string; error: string | null } | null; schedulerSeen: string | null };
}
const bytes = (n: number | null | undefined) => n == null ? "—" : n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} kB`;
const LABEL: Record<string, string> = { web: "Web application", postgres: "PostgreSQL", redis: "Redis", worker: "Worker", realtime: "Realtime gateway" };

export function SystemHealth() {
  const q = useQuery({ queryKey: ["system-health"], queryFn: async () => (await api<Health>("/system/health")).data, refetchInterval: 30_000 });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Checking services…</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">Health check failed: {(q.error as Error | null)?.message ?? "no response"}. The web application itself may be unable to reach its database.</p>;
  const h = q.data;
  const pg = h.services.postgres as Check & { sizeBytes?: number; largestTables?: { name: string; bytes: number; rows: number }[] };
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">Checked {ago(h.checkedAt)} · version {String(h.services.web?.version ?? "?")}
        <button onClick={() => void q.refetch()} className="flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-accent"><RefreshCw className={`h-3 w-3 ${q.isFetching ? "animate-spin" : ""}`} />Re-check</button></div>
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Object.entries(h.services).map(([k, c]) => (
          <div key={k} className="panel p-3">
            <div className="flex items-center justify-between text-sm"><span className="font-medium">{LABEL[k] ?? k}</span><span className="flex items-center gap-1.5 text-xs"><span className={`h-2 w-2 rounded-full ${c.status === "up" ? "bg-success" : c.status === "down" ? "bg-destructive" : "bg-warning"}`} />{c.status}</span></div>
            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {c.latencyMs !== undefined && <div>Response {c.latencyMs} ms</div>}
              {k === "web" && <div>Up {Math.round(Number(c.uptimeSec) / 60)} min · {String(c.node)}</div>}
              {k === "postgres" && c.status === "up" && <div>{String(c.version)} · {bytes(pg.sizeBytes)}</div>}
              {k === "redis" && c.usedMemory != null && <div>Memory {String(c.usedMemory)}</div>}
              {k === "worker" && c.lastBeatSecAgo !== undefined && <div>Heartbeat {String(c.lastBeatSecAgo)}s ago{c.version ? ` · v${c.version}` : ""}</div>}
              {k === "realtime" && c.clients != null && <div>{String(c.clients)} connected browser(s)</div>}
              {c.detail && <div className="text-destructive">{c.detail}</div>}
              {c.hint && <div>{c.hint}</div>}
            </div>
          </div>
        ))}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Collectors</h2>
        {h.collectors.length === 0 ? <p className="panel p-3 text-sm text-muted-foreground">No collectors registered. Create one with <span className="font-mono">pnpm --filter web collector:create &lt;name&gt;</span>.</p> : (
          <div className="panel divide-y text-sm">{h.collectors.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2"><StatusDot status={c.revokedAt ? "OFFLINE" : c.status} /><span className="flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.revokedAt ? "token revoked" : c.lastSeenAt ? `last heartbeat ${ago(c.lastSeenAt)}` : "never connected"}{c.version ? ` · v${c.version}` : ""}</span></div>))}</div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Background jobs</h2>
        {!h.jobs ? <p className="panel p-3 text-sm text-muted-foreground">Unavailable — job counts come from Redis, which is not reachable.</p> : (
          <div className="panel overflow-x-auto"><table className="w-full text-xs">
            <thead className="border-b text-left uppercase tracking-wider text-muted-foreground"><tr>{["Queue", "Active", "Waiting", "Delayed", "Failed (kept)"].map((x) => <th key={x} className="px-3 py-2 font-medium">{x}</th>)}</tr></thead>
            <tbody>{h.jobs.map((j) => <tr key={j.queue} className="border-b font-mono last:border-0"><td className="px-3 py-1.5">{j.queue}</td><td className="px-3">{j.active}</td><td className="px-3">{j.waiting}</td><td className="px-3">{j.delayed}</td><td className={`px-3 ${j.failed ? "text-warning" : ""}`}>{j.failed}</td></tr>)}</tbody>
          </table></div>
        )}
        {h.recentFailures.length > 0 && <div className="panel mt-2 divide-y text-xs">{h.recentFailures.map((f) => <div key={f.id} className="px-3 py-2"><span className="font-mono">{f.queue}/{f.jobName}{f.final ? " · final" : ""}</span> <span className="text-muted-foreground">{ago(f.failedAt)} — {f.error}</span></div>)}</div>}
      </section>
      <section className="grid gap-3 md:grid-cols-2">
        <div className="panel p-3 text-sm">
          <h2 className="mb-1 font-medium">Database backups</h2>
          {h.backup.lastSuccess ? <div className="text-xs text-muted-foreground">Last good backup {ago(h.backup.lastSuccess.finishedAt)}: <span className="font-mono">{h.backup.lastSuccess.fileName}</span> · {bytes(h.backup.lastSuccess.sizeBytes)} · {h.backup.lastSuccess.verified ? "verified" : "not verified"}</div>
            : <div className="text-xs text-warning">No successful backup recorded. Run <span className="font-mono">./scripts/netmon.sh backup</span> or start the backup service.</div>}
          {h.backup.lastAttempt && h.backup.lastAttempt.status !== "SUCCESS" && <div className="mt-1 text-xs text-destructive">Last attempt {ago(h.backup.lastAttempt.startedAt)} failed: {h.backup.lastAttempt.error}</div>}
          <div className="mt-1 text-xs text-muted-foreground">Backup scheduler {h.backup.schedulerSeen ? `last seen ${ago(h.backup.schedulerSeen)}` : "has not reported in"}</div>
        </div>
        {pg.largestTables && <div className="panel p-3 text-xs">
          <h2 className="mb-1 text-sm font-medium">Largest tables</h2>
          {pg.largestTables.map((t) => <div key={t.name} className="flex justify-between font-mono"><span>{t.name}</span><span className="text-muted-foreground">{bytes(t.bytes)} · ~{t.rows} rows</span></div>)}
        </div>}
      </section>
    </div>
  );
}
