import { Suspense } from "react";
import { PageHeader } from "@/components/empty-state";
import { EventsTimeline } from "./events-timeline";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <PageHeader title="Events & Logs" description="Chronological timeline of device, router, collector, scan and network events." />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}><EventsTimeline /></Suspense>
    </>
  );
}
