import { reverse } from "node:dns/promises";

export async function resolveHostname(ip: string, timeoutMs = 1500): Promise<string | undefined> {
  try {
    const names = await Promise.race([reverse(ip), new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]);
    return names[0]?.replace(/\.$/, "");
  } catch { return undefined; }
}
