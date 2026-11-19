import { PageHeader } from "@/components/empty-state";
import { NetworkTable } from "./network-table";
import { DiscoveryPanel } from "./discovery-panel";
export default function NetworksPage() {
  return (<>
    <PageHeader title="Networks" description="Subnets you monitor, their router and collectors. Only configured ranges are ever scanned." />
    <NetworkTable />
    <h2 className="mb-2 mt-6 text-sm font-medium">Discovery</h2>
    <DiscoveryPanel />
  </>);
}
