import type { Metadata } from "next";
import { NewPasswordForm } from "@/components/new-password";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default function Page() {
  return <NewPasswordForm />;
}
