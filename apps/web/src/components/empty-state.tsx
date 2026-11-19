import type { LucideIcon } from "lucide-react";

export function PageHeader({ title, description }: { title: string; description: string }) {
  return <div className="mb-5"><h1 className="text-xl font-semibold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>;
}
export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-3 rounded-md border bg-muted p-2.5"><Icon className="h-5 w-5 text-muted-foreground" /></div>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
export function StatTile({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-2xl">{value ?? <span className="text-muted-foreground">—</span>}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}
