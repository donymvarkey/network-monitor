import type { ApiResponse } from "@netmon/shared-types";

export class FetchError extends Error { constructor(public code: string, message: string) { super(message); } }

export async function api<T>(path: string, init?: RequestInit): Promise<{ data: T; meta?: { page: number; pageSize: number; total: number } }> {
  const res = await fetch(`/api/v1${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok) throw new FetchError(json.error.code, json.error.message);
  return { data: json.data, meta: json.meta };
}
