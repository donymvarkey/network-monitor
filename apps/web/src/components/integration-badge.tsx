import { cn } from "@/lib/utils";

const LABEL: Record<string, [string, string]> = {
  CONNECTED: ["Connected", "border-success/50 text-success"],
  PARTIAL: ["Partially supported", "border-warning/50 text-warning"],
  UNSUPPORTED: ["Unsupported", "border-border text-muted-foreground"],
  AUTH_FAILED: ["Authentication failed", "border-destructive/50 text-destructive"],
  UNREACHABLE: ["Unreachable", "border-destructive/50 text-destructive"],
  NOT_CONFIGURED: ["Not tested yet", "border-border text-muted-foreground"],
};
export function IntegrationBadge({ status }: { status: string }) {
  const [l, c] = LABEL[status] ?? [status, "border-border"];
  return <span className={cn("inline-block rounded border px-1.5 py-0.5 text-xs", c)}>{l}</span>;
}
export const CAP_LABEL: Record<string, string> = { identification: "Identification", availability: "Availability", managementIp: "Management IP", lanIp: "LAN IP", wanIp: "WAN IP", firmware: "Firmware version", model: "Model", interfaces: "Interfaces", dhcpClients: "DHCP clients", connectedClients: "Connected clients", interfaceStats: "Interface statistics", uptime: "Uptime" };
export function formatUptime(s: number | null): string {
  if (s === null) return "unavailable";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
