import { PageHeader } from "@/components/empty-state";
import { AlertsView } from "./alerts-view";

export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <>
      <PageHeader title="Alerts" description="Active, acknowledged and resolved alerts, and the rules that raise them." />
      <AlertsView />
    </>
  );
}
