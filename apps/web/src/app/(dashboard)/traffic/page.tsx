import { prisma } from "@/lib/prisma";
import { getTraffic } from "@/services/traffic";
import { TrafficView } from "./traffic-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const [traffic, networks] = await Promise.all([getTraffic("24h"), prisma.network.findMany({ select: { id: true, name: true, cidr: true }, orderBy: { name: "asc" } })]);
  return <TrafficView initial={JSON.parse(JSON.stringify(traffic))} networks={networks} />;
}
