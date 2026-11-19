"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { StatusDot, ago } from "@/components/status-dot";

interface Net { id: string; name: string; cidr: string; context: string; gateway: string | null; deviceCount: number; routers: { id: string; name: string }[]; collectors: { id: string; name: string; status: string; isPrimary: boolean }[]; lastScan: { status: string; createdAt: string } | null }

export function NetworkTable() {
  const qc = useQueryClient();
  const nets = useQuery({ queryKey: ["networks"], queryFn: () => api<Net[]>("/networks?pageSize=200") });
  const routers = useQuery({ queryKey: ["routers"], queryFn: () => api<{ id: string; name: string }[]>("/routers?pageSize=100") });
  const cols = useQuery({ queryKey: ["collectors"], queryFn: () => api<{ id: string; name: string }[]>("/collectors") });
  const [editing, setEditing] = useState<Net | "new" | null>(null);
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: unknown }) => api(id ? `/networks/${id}` : "/networks", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ["networks"] }); void qc.invalidateQueries({ queryKey: ["collectors"] }); },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? "").trim() || null;
    const collectorIds = f.getAll("collector").map(String); const primary = s("primary");
    save.mutate({ id: editing === "new" ? undefined : editing?.id, body: { name: s("name"), cidr: s("cidr"), context: s("context") ?? "default", gateway: s("gateway"), routerId: s("routerId"), collectors: collectorIds.map((id) => ({ collectorId: id, isPrimary: id === primary })) } });
  }
  const e = editing === "new" ? null : editing;
  const inp = "mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm";
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={() => setEditing(editing ? null : "new")} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">{editing ? "Cancel" : "Add network"}</button></div>
      {editing && (
        <form key={e?.id ?? "new"} onSubmit={submit} className="panel grid gap-3 p-4 text-sm md:grid-cols-3">
          <label><span className="text-xs text-muted-foreground">Name</span><input name="name" required defaultValue={e?.name} className={inp} /></label>
          <label><span className="text-xs text-muted-foreground">CIDR</span><input name="cidr" required placeholder="a.b.c.0/24" defaultValue={e?.cidr} className={`${inp} font-mono`} /></label>
          <label><span className="text-xs text-muted-foreground">Context (separate LANs reusing a range get different contexts)</span><input name="context" defaultValue={e?.context ?? "default"} className={inp} /></label>
          <label><span className="text-xs text-muted-foreground">Gateway</span><input name="gateway" defaultValue={e?.gateway ?? ""} className={`${inp} font-mono`} /></label>
          <label><span className="text-xs text-muted-foreground">Router</span><select name="routerId" defaultValue={e?.routers[0]?.id ?? ""} className={inp}><option value="">None</option>{routers.data?.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <fieldset><span className="text-xs text-muted-foreground">Collectors (● = primary scanner)</span>
            {cols.data?.data.map((c) => { const link = e?.collectors.find((x) => x.id === c.id); return (
              <div key={c.id} className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" name="collector" value={c.id} defaultChecked={!!link} /><input type="radio" name="primary" value={c.id} defaultChecked={link?.isPrimary} title="Primary" />{c.name}</div>); })}
          </fieldset>
          <div className="md:col-span-3 flex items-center gap-3"><button disabled={save.isPending} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Save</button>{save.error && <span className="text-xs text-destructive">{(save.error as Error).message}</span>}</div>
        </form>
      )}
      <div className="panel overflow-x-auto"><table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><tr>{["Name", "CIDR", "Context", "Gateway", "Router", "Collector", "Devices", "Discovery", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{(nets.data?.data ?? []).map((n) => (
          <tr key={n.id} className="border-b last:border-0">
            <td className="px-3 py-2">{n.name}</td><td className="px-3 py-2 font-mono text-xs">{n.cidr}</td><td className="px-3 py-2 text-xs">{n.context}</td>
            <td className="px-3 py-2 font-mono text-xs">{n.gateway ?? "—"}</td><td className="px-3 py-2 text-xs">{n.routers.map((r) => r.name).join(", ") || "—"}</td>
            <td className="px-3 py-2 text-xs">{n.collectors.map((c) => `${c.name}${c.isPrimary ? " ●" : ""}`).join(", ") || "—"}</td>
            <td className="px-3 py-2 text-xs">{n.deviceCount}</td>
            <td className="px-3 py-2">{n.lastScan ? <span className="flex items-center gap-2"><StatusDot status={n.lastScan.status} /><span className="text-xs text-muted-foreground">{ago(n.lastScan.createdAt)}</span></span> : <span className="text-xs text-muted-foreground">never scanned</span>}</td>
            <td className="px-3 py-2"><button onClick={() => setEditing(n)} className="text-xs text-muted-foreground hover:text-foreground">Edit</button></td>
          </tr>))}</tbody>
      </table>{nets.data?.data.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No networks yet. Add one, or start a collector to register its subnet.</p>}</div>
    </div>
  );
}
