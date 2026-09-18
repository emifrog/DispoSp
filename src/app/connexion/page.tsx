import Link from "next/link";
import { SignInForm } from "@/components/auth";
import { HOME_PATH, isConnected } from "@/lib/supabase/config";

export default function Page() {
  // Reachable in demonstration mode too, where signing in means nothing: say so
  // rather than show a form that could never succeed.
  if (!isConnected)
    return (
      <main className="empty-state" id="main">
        <h1>Aucune connexion nécessaire</h1>
        <p>
          L’application tourne en mode démonstration, sur les données locales de ce navigateur. Aucun compte n’est
          requis.
        </p>
        <Link href={HOME_PATH}>Revenir au tableau de bord</Link>
      </main>
    );
  return <SignInForm />;
}
