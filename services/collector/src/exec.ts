import { execFile } from "node:child_process";

/** Runs a binary with args (no shell), bounded by a timeout. */
export function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && "code" in err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
export async function has(cmd: string): Promise<boolean> {
  return (await run("sh", ["-c", `command -v ${cmd}`], 2000)).code === 0;
}
