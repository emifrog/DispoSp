import type { Metadata } from "next";
import { Campaigns } from "@/components/management";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Campagnes" };

export default async function Page() {
  await refuseAgents();
  return <Campaigns />;
}
