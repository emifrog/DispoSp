import Link from "next/link";
export default function NotFound() {
  return (
    <main className="empty-state">
      <h1>Cette page n’existe pas.</h1>
      {/* Sans préchargement, comme la page hors ligne : cette page se sert aussi
          sans session, et le préchargement d'un écran de travail y reçoit une
          redirection que Next ne lit pas. */}
      <Link href="/tableau-de-bord" prefetch={false}>
        Revenir au tableau de bord
      </Link>
    </main>
  );
}
