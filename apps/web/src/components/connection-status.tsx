"use client";
import { useRealtime } from "@/stores/realtime";
import { cn } from "@/lib/utils";

const LABEL = { connecting: "Connecting…", connected: "Live", reconnecting: "Reconnecting…", disconnected: "Live updates offline", unauthorized: "Session expired — sign in again" } as const;

export function ConnectionStatus() {
  const status = useRealtime((s) => s.status);
  const dot = status === "connected" ? "bg-success" : status === "disconnected" || status === "unauthorized" ? "bg-destructive" : "bg-warning animate-pulse";
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite" title="Real-time connection to the monitoring gateway">
      <span className={cn("h-2 w-2 rounded-full", dot)} />{LABEL[status]}
    </span>
  );
}
