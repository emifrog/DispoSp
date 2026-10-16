import type { Metadata } from "next";
import { PersonalPlanning } from "@/components/my-planning";
import { refuseManagers } from "@/components/manager-page";

export const metadata: Metadata = { title: "Mon planning" };

export default async function Page() {
  await refuseManagers();
  return <PersonalPlanning />;
}
