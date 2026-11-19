type Level = "debug" | "info" | "warn" | "error";
export function log(level: Level, msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, svc: "collector", msg, ...extra });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}
