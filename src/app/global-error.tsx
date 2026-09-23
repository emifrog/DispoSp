"use client";

// Last resort: the root layout itself failed, so this replaces <html>. It stays
// dependency-free and inlines its styles because globals.css may be what broke.
//
// `retry` relit le serveur avant de réafficher ; `reset` réaffichait sans relire,
// donc sur la même erreur. La référence (`digest`) d'une erreur serveur est ce
// qu'il faut signaler : son message, en production, est une phrase générique.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "3rem 1.5rem", color: "#0f172a" }}>
        <main style={{ maxWidth: "34rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.4rem" }}>DispoSP n’a pas pu démarrer.</h1>
          <p>Réessayez. Si l’erreur revient, signalez-la avec la référence ci-dessous.</p>
          <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
            {error.digest ? `Référence de l’erreur : ${error.digest}` : `Détail : ${error.message}`}
          </p>
          <button
            onClick={() => retry()}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: "0.5rem",
              padding: "0.6rem 1.1rem",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
