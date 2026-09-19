"use client";
import { useEffect } from "react";

// Tout ce que les écrans affichent vient de la base, relue à chaque navigation :
// un écran qui ne s'affiche pas se retente, il n'y a rien de local à jeter.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="empty-state" id="main">
      <h1>Cet écran n’a pas pu s’afficher.</h1>
      <p>Aucune donnée n’est perdue : elles sont conservées en base et relues à chaque affichage.</p>
      <p className="muted small">{error.message}</p>
      <button onClick={reset}>Réessayer</button>
    </main>
  );
}
