import type { Metadata } from "next";
import { Statistics } from "@/components/statistics";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Statistiques" };

export default async function Page() {
  await refuseAgents();
  return <Statistics />;
}
