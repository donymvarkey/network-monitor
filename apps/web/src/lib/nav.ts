import { LayoutDashboard, MonitorSmartphone, Network, Router, Waypoints, BarChart3, Bell, ScrollText, RadioTower, Settings, HeartPulse } from "lucide-react";
export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/devices", label: "Devices", icon: MonitorSmartphone },
  { href: "/networks", label: "Networks", icon: Network },
  { href: "/routers", label: "Routers", icon: Router },
  { href: "/topology", label: "Network Topology", icon: Waypoints },
  { href: "/traffic", label: "Traffic Analytics", icon: BarChart3 },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/events", label: "Events & Logs", icon: ScrollText },
  { href: "/collectors", label: "Collectors", icon: RadioTower },
  { href: "/system", label: "System Health", icon: HeartPulse },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;
