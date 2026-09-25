import type { Metadata } from "next";
import { Profile } from "@/components/management";

export const metadata: Metadata = { title: "Mon profil" };

export default function Page() {
  return <Profile />;
}
