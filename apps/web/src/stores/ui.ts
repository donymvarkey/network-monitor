import { create } from "zustand";
interface UiState { sidebarOpen: boolean; setSidebar: (v: boolean) => void }
export const useUi = create<UiState>((set) => ({ sidebarOpen: false, setSidebar: (v) => set({ sidebarOpen: v }) }));
