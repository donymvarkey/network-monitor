import "server-only";
import type { Router, RouterCapability } from "@prisma/client";

/** Strips credentials. Every router API response goes through this. */
export function routerDto(r: Router & { capabilities?: RouterCapability[] }) {
  const { credentialsEnc, uptimeSec, ...rest } = r;
  return { ...rest, uptimeSec: uptimeSec === null ? null : Number(uptimeSec), hasCredentials: !!credentialsEnc };
}
