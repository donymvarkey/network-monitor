import "server-only";
import type { Prisma, DeviceStatus } from "@prisma/client";
import { isRandomizedMac } from "@netmon/network-core";
import type { Observation } from "@netmon/shared-validation";

type Tx = Prisma.TransactionClient;

/**
 * Resolve an observation to a device.
 * Rules: never by IP alone, never by hostname alone. A stable (globally administered)
 * MAC is the primary key. Randomized MACs still map 1:1 to a device record but are flagged
 * so an admin can merge them manually. Observations without a MAC are attached to the device
 * currently holding that IP *only* while the address association is open; otherwise skipped.
 */
export async function resolveDevice(tx: Tx, obs: Observation, networkId: string): Promise<string | null> {
  if (obs.mac) {
    const ident = await tx.deviceIdentifier.findUnique({ where: { type_value: { type: "MAC", value: obs.mac } }, include: { device: true } });
    if (ident) {
      await tx.deviceIdentifier.update({ where: { id: ident.id }, data: { lastSeenAt: new Date(obs.observedAt) } });
      return ident.device.mergedIntoId ?? ident.deviceId;
    }
    const device = await tx.device.create({
      data: {
        networkId,
        hostname: obs.hostname,
        vendor: obs.vendor,
        firstSeenAt: new Date(obs.observedAt),
        identifiers: {
          create: [
            { type: "MAC", value: obs.mac, confidence: isRandomizedMac(obs.mac) || obs.macRandomized ? 40 : 100 },
            ...(obs.hostname ? [{ type: "HOSTNAME" as const, value: `${networkId}:${obs.hostname.toLowerCase()}`, confidence: 30 }] : []),
          ],
        },
      },
    });
    return device.id;
  }
  // No MAC (e.g. remote subnet reached via ICMP only): only follow an open IP association.
  const open = await tx.deviceAddress.findFirst({ where: { networkId, address: obs.ip, validTo: null }, orderBy: { validFrom: "desc" } });
  if (open) return open.deviceId;
  // Fallback: no MAC and no known IP association (e.g. macOS ICMP-only). Create a device keyed by
  // network + hostname (or IP) so reachable hosts are listed. Low confidence; merge later if a MAC appears.
  const key = obs.hostname ? `${networkId}:${obs.hostname.toLowerCase()}` : `${networkId}:ip:${obs.ip}`;
  const existing = await tx.deviceIdentifier.findUnique({ where: { type_value: { type: "HOSTNAME", value: key } } });
  if (existing) return existing.deviceId;
  const device = await tx.device.create({
    data: {
      networkId,
      hostname: obs.hostname,
      displayName: obs.hostname || `Host ${obs.ip}`,
      firstSeenAt: new Date(obs.observedAt),
      identifiers: { create: [{ type: "HOSTNAME", value: key, confidence: 50 }] },
    },
  });
  return device.id;
}

/** Close previous open IP associations when an IP moves, open a new one for this device. */
export async function trackAddress(tx: Tx, deviceId: string, networkId: string, ip: string, at: Date): Promise<void> {
  const current = await tx.deviceAddress.findFirst({ where: { deviceId, validTo: null, address: ip } });
  if (current) return;
  await tx.deviceAddress.updateMany({ where: { networkId, address: ip, validTo: null, NOT: { deviceId } }, data: { validTo: at } });
  await tx.deviceAddress.updateMany({ where: { deviceId, networkId, validTo: null }, data: { validTo: at } });
  await tx.deviceAddress.create({ data: { deviceId, networkId, address: ip, validFrom: at } });
}

/** Status machine: online on success; offline only after `threshold` consecutive failures. */
export function nextStatus(current: DeviceStatus, reachable: boolean, failures: number, threshold: number): DeviceStatus {
  if (reachable) return "ONLINE";
  if (failures >= threshold) return "OFFLINE";
  return current === "UNKNOWN" ? "UNKNOWN" : current;
}
