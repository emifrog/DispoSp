import type { Metadata } from "next";
import { Audit } from "@/components/management";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Historique des actions" };

export default async function Page() {
  await refuseAgents();
  return <Audit />;
}
