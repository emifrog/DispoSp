"use client";
// La seule page que l'agent de service garde en mémoire. Elle ne contient
// aucune donnée : c'est ce qui lui permet de ne jamais être périmée.
export default function Offline() {
  return (
    <main className="empty-state">
      <h1>Pas de connexion.</h1>
      <p>
        DispoSP a besoin du réseau : les disponibilités, les affectations et les plannings sont lus en direct, jamais
        depuis une copie qui pourrait dater.
      </p>
      <p>Rétablissez la connexion, puis réessayez.</p>
      {/* Un rechargement complet, et non une navigation du routeur : celle-ci
          demanderait la page au serveur sans quitter l'écran en cas d'échec. */}
      <button onClick={() => location.reload()}>Réessayer</button>
    </main>
  );
}
