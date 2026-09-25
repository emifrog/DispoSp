import type { Metadata } from "next";
import { Availability } from "@/components/availability";

export const metadata: Metadata = { title: "Mes disponibilités" };

export default function Page() {
  return <Availability />;
}
