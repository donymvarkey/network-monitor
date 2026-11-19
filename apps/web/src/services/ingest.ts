import "server-only";
import { prisma } from "@/lib/prisma";
import { publishEvent } from "@/lib/redis";
import { ipInCidr } from "@netmon/network-core";
import type { Observation } from "@netmon/shared-validation";
import { nextStatus, resolveDevice, trackAddress } from "./device-identity";

export async function ingestObservations(collectorId: string, cidr: string, scanJobId: string | null, observations: Observation[]) {
  const link = await prisma.collectorNetwork.findFirst({ where: { collectorId, network: { cidr } }, include: { network: true } });
  if (!link) throw new Error(`Collector is not assigned to ${cidr}`);
  if (scanJobId) {
    // A collector may only attach observations to its own scan on this network.
    const job = await prisma.scanJob.findFirst({ where: { id: scanJobId, collectorId, networkId: link.networkId } });
    if (!job) throw new Error("Scan job does not belong to this collector/network");
  }
  const network = link.network;
  const events: { event: "device:discovered" | "device:online" | "device:offline" | "device:updated"; payload: unknown }[] = [];
  let created = 0;

  for (const obs of observations) {
    if (!ipInCidr(obs.ip, cidr)) continue; // never accept data outside the configured range
    const at = new Date(obs.observedAt);
    await prisma.$transaction(async (tx) => {
      const before = obs.mac ? await tx.deviceIdentifier.findUnique({ where: { type_value: { type: "MAC", value: obs.mac } } }) : null;
      const deviceId = await resolveDevice(tx, obs, network.id);
      if (!deviceId) return;
      const isNew = obs.mac ? !before : false;
      const device = await tx.device.findUniqueOrThrow({ where: { id: deviceId } });
      const status = nextStatus(device.status, obs.reachable, obs.consecutiveFailures, network.offlineThreshold);

      for (const method of obs.methods) {
        await tx.deviceObservation.create({
          data: { deviceId, collectorId, source: "collector", method, scanJobId, ipAddress: obs.ip, macAddress: obs.mac, hostname: obs.hostname, reachable: obs.reachable, latencyMs: obs.latencyMs, observedAt: at },
        });
      }
      if (obs.reachable) await trackAddress(tx, deviceId, network.id, obs.ip, at);

      await tx.device.update({
        where: { id: deviceId },
        data: {
          status,
          consecutiveFailures: obs.reachable ? 0 : obs.consecutiveFailures,
          icmpBlocked: obs.icmpBlocked,
          lastCollectorId: collectorId,
          ...(obs.reachable ? { lastSeenAt: at, lastSuccessfulAt: at } : {}),
          ...(obs.hostname && !device.hostname ? { hostname: obs.hostname } : {}),
          ...(obs.vendor && !device.vendor ? { vendor: obs.vendor } : {}),
        },
      });
      if (status !== device.status) {
        await tx.deviceStatusTransition.create({ data: { deviceId, fromStatus: device.status, toStatus: status, reason: obs.reachable ? "observed reachable" : `${obs.consecutiveFailures} consecutive failed checks` } });
        await tx.networkEvent.create({ data: { networkId: network.id, deviceId, type: `device.${status.toLowerCase()}`, severity: status === "OFFLINE" ? "WARNING" : "INFO", message: `Device ${device.displayName ?? obs.hostname ?? obs.ip} is ${status.toLowerCase()}` } });
        if (status === "ONLINE") events.push({ event: "device:online", payload: { deviceId } });
        if (status === "OFFLINE") events.push({ event: "device:offline", payload: { deviceId } });
      }
      if (isNew) {
        created++;
        await tx.networkEvent.create({ data: { networkId: network.id, deviceId, type: "device.discovered", message: `New device ${obs.mac} at ${obs.ip}` } });
        events.push({ event: "device:discovered", payload: { deviceId } });
      } else if (status === device.status) {
        events.push({ event: "device:updated", payload: { deviceId } });
      }
    });
  }
  // Publish only after commit.
  for (const e of events) await publishEvent(e.event, e.payload);
  return { processed: observations.length, created };
}
