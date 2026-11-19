import { cn } from "@/lib/utils";
export function StatusDot({ status }: { status: string }) {
  const c = status === "ONLINE" || status === "CONNECTED" || status === "COMPLETED" ? "bg-success" : status === "OFFLINE" || status === "DISCONNECTED" || status === "FAILED" ? "bg-destructive" : status === "RUNNING" || status === "DISPATCHED" || status === "QUEUED" ? "bg-warning" : "bg-muted-foreground";
  return <span className="inline-flex items-center gap-1.5 text-xs"><span className={cn("h-2 w-2 rounded-full", c)} />{status.toLowerCase()}</span>;
}
export function ago(d: string | null | undefined): string {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
}
