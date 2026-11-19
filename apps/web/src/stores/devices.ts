import { create } from "zustand";

/** Client-only view state for the inventory table (filters live in the URL-less store). */
interface DeviceFilters {
  q: string; status: "" | "ONLINE" | "OFFLINE" | "UNKNOWN"; networkId: string; sort: string; page: number;
  set: (p: Partial<Omit<DeviceFilters, "set">>) => void;
}
export const useDeviceFilters = create<DeviceFilters>((set) => ({
  q: "", status: "", networkId: "", sort: "-lastSeenAt", page: 1,
  set: (p) => set((s) => ({ ...s, ...p, page: p.page ?? 1 })),
}));
