import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DeviceDetail } from "./device-detail";

export const dynamic = "force-dynamic";

/** Server Component: the device record is server-rendered; tabs fetch their data on demand. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await prisma.device.findUnique({ where: { id }, include: { network: true, identifiers: true, addresses: { where: { validTo: null } }, mergedFrom: { select: { id: true, displayName: true, hostname: true } } } });
  if (!d) notFound();
  return <DeviceDetail id={id} initial={JSON.parse(JSON.stringify(d))} />;
}
