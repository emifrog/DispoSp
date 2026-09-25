import type { Metadata } from "next";
import { Settings } from "@/components/management";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Paramètres du centre" };

export default async function Page() {
  await refuseAgents();
  return <Settings />;
}
