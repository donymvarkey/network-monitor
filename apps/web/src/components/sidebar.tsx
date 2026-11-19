"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";
import { NAV } from "@/lib/nav";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const path = usePathname();
  const { sidebarOpen, setSidebar } = useUi();
  return (
    <aside className={cn("fixed inset-y-0 left-0 z-40 w-60 border-r bg-card transition-transform md:static md:translate-x-0", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-14 items-center gap-2 border-b px-4"><Activity className="h-5 w-5 text-primary" /><span className="text-sm font-semibold">NetWatch</span></div>
      <nav className="space-y-0.5 p-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} onClick={() => setSidebar(false)} className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent", active && "bg-accent text-foreground")}>
              <Icon className="h-4 w-4" />{label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
