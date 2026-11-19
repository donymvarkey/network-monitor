"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { ago } from "@/components/status-dot";
import { useMe } from "@/hooks/use-me";

/** Rotate shows the new token exactly once; it is never stored or retrievable afterwards. */
export function CollectorTokenActions({ c }: { c: { id: string; name: string; revokedAt: string | null; tokenRotatedAt: string | null } }) {
  const qc = useQueryClient();
  const { isAdmin } = useMe();
  const [token, setToken] = useState<string | null>(null);
  const rotate = useMutation({ mutationFn: async () => (await api<{ token: string }>(`/collectors/${c.id}/token`, { method: "POST" })).data, onSuccess: (d) => { setToken(d.token); void qc.invalidateQueries({ queryKey: ["collectors"] }); } });
  const revoke = useMutation({ mutationFn: () => api(`/collectors/${c.id}/token`, { method: "DELETE" }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["collectors"] }) });
  return (
    <div className="space-y-1 text-xs">
      <div className="text-muted-foreground">{c.revokedAt ? <span className="text-destructive">revoked {ago(c.revokedAt)}</span> : c.tokenRotatedAt ? `rotated ${ago(c.tokenRotatedAt)}` : "original"}</div>
      {isAdmin && <div className="flex gap-1.5">
        <button onClick={() => { if (confirm(`Issue a new token for ${c.name}? The current token stops working immediately.`)) rotate.mutate(); }} className="rounded-md border px-2 py-0.5 hover:bg-accent">Rotate</button>
        {!c.revokedAt && <button onClick={() => { if (confirm(`Revoke ${c.name}? It will be rejected until you rotate its token.`)) revoke.mutate(); }} className="rounded-md border px-2 py-0.5 hover:bg-accent">Revoke</button>}
      </div>}
      {token && (
        <div className="panel max-w-xs space-y-1 p-2">
          <div>New token — copy it into <span className="font-mono">.env.collector</span> as COLLECTOR_TOKEN now. It will not be shown again.</div>
          <code className="block break-all rounded bg-muted p-1 font-mono">{token}</code>
          <button onClick={() => { void navigator.clipboard.writeText(token); }} className="rounded-md border px-2 py-0.5 hover:bg-accent">Copy</button>
          <button onClick={() => setToken(null)} className="ml-1 rounded-md border px-2 py-0.5 hover:bg-accent">Done</button>
        </div>
      )}
    </div>
  );
}
