import { getCharts, getDashboard } from "@/services/dashboard";
import { DashboardView } from "./dashboard-view";

// Monitoring data must never be served from a static/ISR cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Server Component: initial numbers are rendered on the server, then the client keeps them live. */
export default async function Overview() {
  const [dashboard, charts] = await Promise.all([getDashboard(), getCharts("24h")]);
  return <DashboardView initial={dashboard} initialCharts={charts} />;
}
