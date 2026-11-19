"use client";
import { Menu, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUi } from "@/stores/ui";
import { ConnectionStatus } from "./connection-status";
import { NotificationBell } from "./notification-bell";

export function Header() {
  const setSidebar = useUi((s) => s.setSidebar);
  const router = useRouter();
  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
  }
  return (
    <header className="flex h-14 items-center gap-3 border-b px-4 md:px-6">
      <button className="md:hidden" onClick={() => setSidebar(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      <span className="text-xs text-muted-foreground">Home network</span>
      <div className="ml-auto"><ConnectionStatus /></div>
      <NotificationBell />
      <button onClick={logout} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><LogOut className="h-3.5 w-3.5" />Sign out</button>
    </header>
  );
}
