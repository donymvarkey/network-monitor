"use client";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SeriesDef { key: string; label: string; color: string; format?: (v: number) => string }
const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tick = (range: string) => (t: string) => { const d = new Date(t); return range === "24h" || range === "1h" || range === "6h" ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
export const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
export const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;

/** Time-series chart. Gaps (null) are drawn as gaps — missing data is never interpolated into fake values. */
export function TimeChart({ data, series, range, area, yDomain, height = 200 }: { data: Record<string, unknown>[]; series: SeriesDef[]; range: string; area?: boolean; yDomain?: [number, number]; height?: number }) {
  const fmt = series[0]?.format ?? ((v: number) => String(v));
  // Isolated measurements between gaps have no line to draw; show them as dots so a real sample is never invisible.
  const sparse = data.some((d, i) => series.some((s) => d[s.key] != null && data[i - 1]?.[s.key] == null && data[i + 1]?.[s.key] == null));
  const tooltip = <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} labelFormatter={(t) => new Date(String(t)).toLocaleString()} formatter={(v, name) => { const s = series.find((x) => x.label === name); return [v === null || v === undefined ? "no data" : (s?.format ?? fmt)(Number(v)), name]; }} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {area ? (
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="t" tickFormatter={tick(range)} {...axis} minTickGap={32} />
          <YAxis tickFormatter={(v) => fmt(Number(v))} domain={yDomain ?? ["auto", "auto"]} {...axis} width={56} />
          {tooltip}
          {series.map((s) => <Area key={s.key} dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={1.5} connectNulls={false} isAnimationActive={false} dot={sparse ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false} />)}
        </AreaChart>
      ) : (
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="t" tickFormatter={tick(range)} {...axis} minTickGap={32} />
          <YAxis tickFormatter={(v) => fmt(Number(v))} domain={yDomain ?? ["auto", "auto"]} {...axis} width={56} />
          {tooltip}
          {series.map((s) => <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

export function ChartPanel({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{title}</h3>
      {empty ? <div className="flex h-[200px] items-center justify-center text-center text-sm text-muted-foreground">No history recorded for this period yet</div> : children}
    </div>
  );
}

export function RangeToggle({ value, onChange }: { value: string; onChange: (v: "24h" | "7d" | "30d") => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      {(["24h", "7d", "30d"] as const).map((r) => (
        <button key={r} onClick={() => onChange(r)} className={`rounded px-2.5 py-1 ${value === r ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{r}</button>
      ))}
    </div>
  );
}
