import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/current-user";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { RealtimeSync } from "@/components/realtime-sync";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Expired, revoked or disabled sessions are sent back to sign-in, not just missing cookies.
  if (!(await currentUser())) redirect("/login?expired=1");
  return (
    <div className="flex min-h-screen">
      <RealtimeSync />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col"><Header /><main className="flex-1 p-4 md:p-6">{children}</main></div>
    </div>
  );
}
