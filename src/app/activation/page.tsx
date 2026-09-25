import type { Metadata } from "next";
import { NewPasswordForm } from "@/components/new-password";

export const metadata: Metadata = { title: "Activer mon compte" };

export default function Page() {
  return <NewPasswordForm variant="activation" />;
}
