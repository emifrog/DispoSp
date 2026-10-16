import type { Metadata } from "next";
import { Availability } from "@/components/availability";
import { refuseManagers } from "@/components/manager-page";

export const metadata: Metadata = { title: "Mes disponibilités" };

export default async function Page() {
  await refuseManagers();
  return <Availability />;
}
