import { PageHeader } from "@/components/empty-state";
import { DeviceTable } from "./device-table";
export default function DevicesPage() {
  return (<><PageHeader title="Devices" description="Every device seen on your networks, identified by MAC and other stable identifiers — never by IP." /><DeviceTable /></>);
}
