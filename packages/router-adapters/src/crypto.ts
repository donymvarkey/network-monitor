import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM with ROUTER_CREDENTIALS_KEY (32 bytes, base64). Format: iv.tag.ciphertext (base64). */
function key(): Buffer {
  const k = Buffer.from(process.env.ROUTER_CREDENTIALS_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("ROUTER_CREDENTIALS_KEY must be 32 bytes base64 (openssl rand -base64 32)");
  return k;
}
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
export function decryptJson<T>(blob: string): T {
  const [iv, tag, data] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv!);
  d.setAuthTag(tag!);
  return JSON.parse(Buffer.concat([d.update(data!), d.final()]).toString("utf8")) as T;
}
