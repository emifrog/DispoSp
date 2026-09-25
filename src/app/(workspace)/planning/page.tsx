import type { Metadata } from "next";
import { Planning } from "@/components/planning";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Construire le planning" };

export default async function Page() {
  await refuseAgents();
  return <Planning />;
}
