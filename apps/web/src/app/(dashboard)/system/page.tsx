import { PageHeader } from "@/components/empty-state";
import { SystemHealth } from "./system-health";

export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <>
      <PageHeader title="System Health" description="Live status of every NetWatch service, measured when this page loads." />
      <SystemHealth />
    </>
  );
}
