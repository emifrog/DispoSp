import type { Metadata } from "next";
import { Agents } from "@/components/management";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Agents & équipes" };

export default async function Page() {
  await refuseAgents();
  return <Agents />;
}
