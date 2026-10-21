import type { Metadata } from "next";
import { Calls } from "@/components/calls";
import { refuseManagers } from "@/components/manager-page";

export const metadata: Metadata = { title: "Appels" };

// Les appels qui sollicitent l'agent (lot C). L'encadrement les suit depuis le
// planning et les désistements, pas d'ici.
export default async function Page() {
  await refuseManagers();
  return <Calls />;
}
