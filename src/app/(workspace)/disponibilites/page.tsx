import type { Metadata } from "next";
import { AvailabilityTable } from "@/components/availability-table";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Disponibilités de l’équipe" };

export default async function Page() {
  await refuseAgents();
  return <AvailabilityTable />;
}
