/** Formatting helpers. Callers pass null for "not measured" and get "Unavailable", never "0". */
export function bytes(v: number | null | undefined): string {
  if (v === null || v === undefined) return "Unavailable";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, x = v;
  while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
  return `${x < 10 && i ? x.toFixed(2) : x < 100 && i ? x.toFixed(1) : Math.round(x)} ${u[i]}`;
}
export function bps(v: number | null | undefined): string {
  if (v === null || v === undefined) return "Unavailable";
  const u = ["bit/s", "kbit/s", "Mbit/s", "Gbit/s"]; let i = 0, x = v;
  while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
  return `${x < 10 && i ? x.toFixed(2) : x < 100 && i ? x.toFixed(1) : Math.round(x)} ${u[i]}`;
}
export const TRAFFIC_RANGE_OPTIONS = [
  { v: "1h", label: "Last hour" }, { v: "6h", label: "6 hours" }, { v: "24h", label: "24 hours" }, { v: "7d", label: "7 days" }, { v: "30d", label: "30 days" },
] as const;
export type TrafficRangeValue = (typeof TRAFFIC_RANGE_OPTIONS)[number]["v"];
