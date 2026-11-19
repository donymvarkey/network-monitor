"use client";
import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { ago } from "./status-dot";

interface N { id: string; kind: string; title: string; readAt: string | null; createdAt: string }

/** In-app notification channel. Refreshed by realtime events (notification:new), not polling. */
export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["notifications"], queryFn: async () => (await api<{ items: N[]; unread: number }>("/notifications")).data });
  const read = useMutation({ mutationFn: () => api("/notifications/read", { method: "POST" }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative">
      <button onClick={() => { setOpen(!open); if (!open && unread) read.mutate(); }} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative flex items-center text-muted-foreground hover:text-foreground">
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-destructive px-1 text-center font-mono text-[10px] leading-4 text-primary-foreground">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="panel absolute right-0 top-7 z-50 w-80 shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2 text-xs"><span className="font-medium">Notifications</span><Link href="/alerts" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">All alerts</Link></div>
          <div className="max-h-80 divide-y overflow-y-auto">
            {(q.data?.items ?? []).length === 0 ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications yet.</p> :
              q.data!.items.map((n) => (
                <div key={n.id} className={`px-3 py-2 text-xs ${n.readAt ? "text-muted-foreground" : ""}`}>
                  <div>{n.title}</div><div className="mt-0.5 text-muted-foreground">{ago(n.createdAt)}</div>
                </div>))}
          </div>
        </div>
      )}
    </div>
  );
}
