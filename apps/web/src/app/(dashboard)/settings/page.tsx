import { PageHeader } from "@/components/empty-state";
import { MonitoringSettings } from "./monitoring-settings";
import { NotificationSettings } from "./notification-settings";
import { SecuritySettings } from "./security-settings";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" description="Monitoring intervals, notifications and account security." />
      <div className="space-y-8"><MonitoringSettings /><NotificationSettings /><SecuritySettings /></div>
    </>
  );
}
