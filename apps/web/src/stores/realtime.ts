import { create } from "zustand";
export type RealtimeStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "unauthorized";
interface RealtimeState { status: RealtimeStatus; lastEventAt: string | null; set: (s: Partial<Omit<RealtimeState, "set">>) => void }
export const useRealtime = create<RealtimeState>((set) => ({ status: "connecting", lastEventAt: null, set: (s) => set(s) }));
