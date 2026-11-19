import { readFile } from "node:fs/promises";
import { macOui } from "@netmon/network-core";
import { log } from "../log.js";

let table: Map<string, string> | null = null;

/** Loads the IEEE OUI registry (oui.txt) if present; vendor lookup is best-effort. */
export async function loadOui(file?: string): Promise<void> {
  table = new Map();
  for (const f of [file, "/usr/share/oui.txt", "/usr/share/ieee-data/oui.txt", "/usr/share/arp-scan/ieee-oui.txt"].filter(Boolean) as string[]) {
    const text = await readFile(f, "utf8").catch(() => null);
    if (!text) continue;
    for (const line of text.split("\n")) {
      const a = /^([0-9A-F]{2})-([0-9A-F]{2})-([0-9A-F]{2})\s+\(hex\)\s+(.+)$/.exec(line.trim());
      if (a) { table.set(a[1]! + a[2]! + a[3]!, a[4]!.trim()); continue; }
      const b = /^([0-9A-F]{6})\t(.+)$/i.exec(line.trim()); // arp-scan format
      if (b) table.set(b[1]!.toUpperCase(), b[2]!.trim());
    }
    log("info", "OUI table loaded", { file: f, entries: table.size });
    return;
  }
  log("warn", "No OUI file found; vendor lookup disabled");
}
export function vendorFor(mac: string): string | undefined { return table?.get(macOui(mac)); }
