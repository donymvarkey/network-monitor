export const REALTIME_EVENTS = [
  "device:discovered", "device:online", "device:offline", "device:updated",
  "router:status_changed", "router:metrics_updated", "network:health_updated",
  "alert:created", "collector:connected", "collector:disconnected",
  "scan:progress", "scan:completed", "scan:failed",
  // Phase 4
  "router:unavailable", "router:recovered", "collector:reconnected",
  "network:event", "latency:updated",
  // Phase 5
  "traffic:updated", "topology:updated",
  // Phase 6
  "alert:resolved", "alert:updated", "notification:new",
] as const;
export type RealtimeEvent = (typeof REALTIME_EVENTS)[number];

export interface RealtimeEnvelope<T = unknown> {
  event: RealtimeEvent;
  payload: T;
  emittedAt: string;
}

export type ApiSuccess<T> = { ok: true; data: T; meta?: { page: number; pageSize: number; total: number } };
export type ApiError = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
