import type { Config } from "./config.js";
import { log } from "./log.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with timeout and exponential backoff (retries 5xx/network errors, not 4xx). */
export function createApi(cfg: Config) {
  return async function post<T>(path: string, body: unknown, attempts = 4): Promise<T> {
    let lastErr: unknown;
    for (let a = 0; a < attempts; a++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const res = await fetch(new URL(`/api/v1${path}`, cfg.API_BASE_URL), {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.COLLECTOR_TOKEN}`, "x-collector-id": cfg.COLLECTOR_ID, ...(cfg.NETWORK_CONTEXT && { "x-network-context": cfg.NETWORK_CONTEXT }) },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { message: string } };
        if (res.ok && json.ok) return json.data as T;
        if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(json.error?.message ?? `HTTP ${res.status}`), { fatal: true });
        lastErr = new Error(json.error?.message ?? `HTTP ${res.status}`);
      } catch (e) {
        if ((e as { fatal?: boolean }).fatal) throw e;
        lastErr = e;
      } finally { clearTimeout(t); }
      const wait = Math.min(30_000, 1000 * 2 ** a);
      log("warn", "API request failed, retrying", { path, attempt: a + 1, waitMs: wait, error: String(lastErr) });
      await sleep(wait);
    }
    throw lastErr;
  };
}
