"use client";
import type { ReactNode } from "react";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";

interface Initial { id: string; name: string; manufacturer: string | null; model: string | null; managementIp: string | null; networkId: string; integrationMethod: string; pollIntervalSec: number; assignedCollectorId: string | null; hasCredentials: boolean }
const METHODS: [string, string][] = [["ICMP", "Ping only (availability)"], ["HTTP_PROBE", "Generic: ping + web UI probe"], ["SNMP_V2C", "SNMP v2c (standard MIB-II)"], ["SNMP_V3", "SNMP v3 (standard MIB-II)"], ["DLINK_HNAP", "D-Link HNAP (probed per firmware)"], ["NONE", "Disabled"]];

/** Credentials are write-only: the form never receives existing values. */
export function RouterForm({ initial, onDone }: { initial?: Initial; onDone?: () => void }) {
  const qc = useQueryClient();
  const nets = useQuery({ queryKey: ["networks"], queryFn: () => api<{ id: string; name: string; cidr: string; context: string }[]>("/networks?pageSize=200") });
  const cols = useQuery({ queryKey: ["collectors"], queryFn: () => api<{ id: string; name: string }[]>("/collectors") });
  const [method, setMethod] = useState(initial?.integrationMethod ?? "ICMP");
  const [changeCreds, setChangeCreds] = useState(!initial);
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(initial ? `/routers/${initial.id}` : "/routers", { method: initial ? "PATCH" : "POST", body: JSON.stringify(body) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["routers"] }); void qc.invalidateQueries({ queryKey: ["router"] }); onDone?.(); },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget); const s = (k: string) => (String(f.get(k) ?? "").trim() || null);
    const creds = method === "SNMP_V2C" ? { community: s("community") ?? undefined } : method === "SNMP_V3" ? { snmpUser: s("snmpUser") ?? undefined, authKey: s("authKey") ?? undefined, privKey: s("privKey") ?? undefined } : method === "DLINK_HNAP" ? { username: s("username") ?? undefined, password: s("password") ?? undefined } : null;
    const hasAny = creds && Object.values(creds).some(Boolean);
    m.mutate({
      name: s("name"), manufacturer: s("manufacturer"), model: s("model"), managementIp: s("managementIp"), networkId: s("networkId"),
      integrationMethod: method, pollIntervalSec: Number(f.get("pollIntervalSec")), assignedCollectorId: s("assignedCollectorId"),
      ...(changeCreds && { credentials: hasAny ? creds : null }),
    });
  }
  const inp = "mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm";
  return (
    <form onSubmit={submit} className="panel grid gap-3 p-4 text-sm md:grid-cols-3">
      <L t="Router name"><input name="name" required defaultValue={initial?.name} className={inp} /></L>
      <L t="Manufacturer"><input name="manufacturer" defaultValue={initial?.manufacturer ?? ""} className={inp} /></L>
      <L t="Model"><input name="model" defaultValue={initial?.model ?? ""} className={inp} /></L>
      <L t="Management IP"><input name="managementIp" required defaultValue={initial?.managementIp ?? ""} className={`${inp} font-mono`} /></L>
      <L t="LAN subnet (network)"><select name="networkId" required defaultValue={initial?.networkId} className={inp}><option value="">Select…</option>{nets.data?.data.map((n) => <option key={n.id} value={n.id}>{n.name} · {n.cidr} [{n.context}]</option>)}</select></L>
      <L t="Assigned collector"><select name="assignedCollectorId" defaultValue={initial?.assignedCollectorId ?? ""} className={inp}><option value="">None</option>{cols.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></L>
      <L t="Integration method"><select value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></L>
      <L t="Polling interval (seconds)"><input name="pollIntervalSec" type="number" min={15} max={3600} defaultValue={initial?.pollIntervalSec ?? 60} className={inp} /></L>
      <div className="md:col-span-3 border-t pt-3">
        <div className="mb-2 flex items-center gap-3 text-xs text-muted-foreground">Authentication {initial?.hasCredentials && <span className="text-success">· credentials stored (encrypted)</span>}
          {initial && <label className="flex items-center gap-1"><input type="checkbox" checked={changeCreds} onChange={(e) => setChangeCreds(e.target.checked)} />change</label>}</div>
        {changeCreds && (method === "SNMP_V2C" ? <L t="Community"><input name="community" type="password" autoComplete="off" className={inp} /></L>
          : method === "SNMP_V3" ? <div className="grid gap-3 md:grid-cols-3"><L t="User"><input name="snmpUser" autoComplete="off" className={inp} /></L><L t="Auth key (SHA)"><input name="authKey" type="password" autoComplete="off" className={inp} /></L><L t="Privacy key (AES)"><input name="privKey" type="password" autoComplete="off" className={inp} /></L></div>
          : method === "DLINK_HNAP" ? <div className="grid gap-3 md:grid-cols-2"><L t="Username"><input name="username" placeholder="Admin" autoComplete="off" className={inp} /></L><L t="Password"><input name="password" type="password" autoComplete="new-password" className={inp} /></L></div>
          : <p className="text-xs text-muted-foreground">No credentials needed for this method.</p>)}
      </div>
      <div className="md:col-span-3 flex items-center gap-3">
        <button disabled={m.isPending} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-60">{m.isPending ? "Saving…" : initial ? "Save changes" : "Add router"}</button>
        {m.error && <span className="text-xs text-destructive">{(m.error as Error).message}</span>}
      </div>
    </form>
  );
}
function L({ t, children }: { t: string; children: ReactNode }) { return <label className="block"><span className="text-xs text-muted-foreground">{t}</span>{children}</label>; }
