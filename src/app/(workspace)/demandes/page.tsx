import type { Metadata } from "next";
import { Withdrawals } from "@/components/withdrawals";
import { refuseAgents } from "@/components/manager-page";

export const metadata: Metadata = { title: "Désistements" };

export default async function Page() {
  await refuseAgents();
  return <Withdrawals />;
}
