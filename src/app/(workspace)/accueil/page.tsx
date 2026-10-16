import type { Metadata } from "next";
import { AgentHome } from "@/components/home";
import { refuseManagers } from "@/components/manager-page";

export const metadata: Metadata = { title: "Accueil" };

export default async function Page() {
  await refuseManagers();
  return <AgentHome />;
}
