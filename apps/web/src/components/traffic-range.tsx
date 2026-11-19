"use client";
import { TRAFFIC_RANGE_OPTIONS, type TrafficRangeValue } from "./traffic-format";

export function TrafficRangeToggle({ value, onChange }: { value: TrafficRangeValue; onChange: (v: TrafficRangeValue) => void }) {
  return (
    <div role="group" aria-label="Time range" className="inline-flex rounded-md border p-0.5 text-xs">
      {TRAFFIC_RANGE_OPTIONS.map((r) => (
        <button key={r.v} aria-pressed={value === r.v} onClick={() => onChange(r.v)} className={`rounded px-2.5 py-1 ${value === r.v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{r.label}</button>
      ))}
    </div>
  );
}
