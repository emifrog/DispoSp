import type { Metadata } from "next";
import { AgentHome } from "@/components/home";

export const metadata: Metadata = { title: "Accueil" };

export default function Page() {
  return <AgentHome />;
}
