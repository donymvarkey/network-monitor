import { getTopology } from "@/services/topology";
import { TopologyView } from "./topology-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Server Component: the first map is built from stored records on the server. */
export default async function Page() {
  const topo = await getTopology({ showOffline: true });
  return <TopologyView initial={JSON.parse(JSON.stringify(topo))} />;
}
