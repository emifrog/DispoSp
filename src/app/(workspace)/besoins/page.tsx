import type { Metadata } from "next";
import { Needs } from "@/components/needs";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Besoins du mois" };

export default async function Page() {
  await refuseAgents();
  return <Needs />;
}
