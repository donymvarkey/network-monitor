"use client";
import { useRealtimeSync } from "@/hooks/use-realtime";

/** Mounted only inside the signed-in dashboard, so the socket handshake always carries the session cookie. */
export function RealtimeSync() { useRealtimeSync(); return null; }
