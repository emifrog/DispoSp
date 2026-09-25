import type { Metadata } from "next";
import { PersonalPlanning } from "@/components/my-planning";

export const metadata: Metadata = { title: "Mon planning" };

export default function Page() {
  return <PersonalPlanning />;
}
