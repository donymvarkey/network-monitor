"use client";
import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { REALTIME_EVENTS, type RealtimeEnvelope } from "@netmon/shared-types";
import { useRealtime } from "@/stores/realtime";

let socket: Socket | null = null;

/** Which cached queries each live event makes stale. Only those refetch — no page reloads, no polling. */
function invalidate(qc: QueryClient, evt: string, payload: Record<string, unknown> | undefined): void {
  const inv = (queryKey: unknown[]) => void qc.invalidateQueries({ queryKey });
  if (evt.startsWith("device:")) { inv(["devices"]); inv(payload?.deviceId ? ["device", payload.deviceId] : ["device"]); inv(["events"]); }
  if (evt.startsWith("router:")) { inv(["routers"]); inv(["router"]); if (evt !== "router:metrics_updated") inv(["events"]); }
  if (evt.startsWith("scan:")) { inv(["scans"]); inv(["networks"]); }
  if (evt.startsWith("collector:") || evt.startsWith("scan:")) inv(["collectors"]);
  if (evt === "network:event" || evt === "alert:created" || evt === "scan:completed" || evt === "scan:failed") inv(["events"]);
  if (evt === "alert:created" || evt === "alert:resolved" || evt === "alert:updated") { inv(["alerts"]); inv(["notifications"]); }
  if (evt === "notification:new") inv(["notifications"]);
  if (evt === "latency:updated") { inv(["device"]); inv(["dashboard"]); }
  if (evt === "network:health_updated") inv(["dashboard", "charts"]);
  if (evt === "traffic:updated") { inv(["traffic"]); inv(["device"]); }
  if (evt.startsWith("device:") || evt === "router:status_changed" || evt.startsWith("collector:") || evt === "topology:updated") inv(["topology"]);
  if (evt !== "router:metrics_updated" && evt !== "scan:progress" && evt !== "traffic:updated") inv(["dashboard"]);
}

/** Single shared socket with automatic reconnect; status is exposed for the header indicator. */
export function useRealtimeSync(): void {
  const qc = useQueryClient();
  const set = useRealtime((s) => s.set);
  useEffect(() => {
    // Same-origin connection (nginx in Docker, a Next.js rewrite in dev) so the session cookie is sent.
    socket ??= io({
      path: "/socket.io", addTrailingSlash: false, withCredentials: true, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15_000, randomizationFactor: 0.5,
    });
    const s = socket;
    let wasConnected = s.connected;
    set({ status: s.connected ? "connected" : "connecting" });
    const onConnect = () => {
      set({ status: "connected" });
      // Events may have been missed while offline: refresh whatever is on screen once.
      if (wasConnected) void qc.invalidateQueries();
      wasConnected = true;
    };
    const onDisconnect = (reason: string) => set({ status: reason === "io client disconnect" ? "disconnected" : "reconnecting" });
    const onError = (err: Error) => {
      if (err.message === "unauthorized") { set({ status: "unauthorized" }); return; } // stop hammering with a bad session
      set({ status: "reconnecting" });
    };
    s.on("connect", onConnect); s.on("disconnect", onDisconnect); s.on("connect_error", onError);
    s.io.on("reconnect_attempt", () => set({ status: "reconnecting" }));
    s.io.on("reconnect_failed", () => set({ status: "disconnected" }));
    const handlers = REALTIME_EVENTS.map((evt) => {
      const fn = (msg: RealtimeEnvelope<Record<string, unknown>>) => { set({ lastEventAt: msg?.emittedAt ?? new Date().toISOString() }); invalidate(qc, evt, msg?.payload); };
      s.on(evt, fn);
      return [evt, fn] as const;
    });
    return () => {
      handlers.forEach(([e, fn]) => s.off(e, fn));
      s.off("connect", onConnect); s.off("disconnect", onDisconnect); s.off("connect_error", onError);
      s.io.off("reconnect_attempt"); s.io.off("reconnect_failed");
      // Leaving the dashboard (e.g. sign-out): close it so the next sign-in handshakes with the new cookie.
      s.disconnect(); socket = null;
    };
  }, [qc, set]);
}
