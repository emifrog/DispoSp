"use client";
import { useEffect } from "react";
import { clearDemoStorage } from "@/lib/storage";

// Everything this demonstration renders comes from browser storage, so a crash is
// most often a state the screens cannot draw. "Réessayer" re-renders the same
// state; the second action drops it and starts again from the sample data.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="empty-state" id="main">
      <h1>Cet écran n’a pas pu s’afficher.</h1>
      <p>
        Vos données de démonstration sont conservées dans ce navigateur. Vous pouvez réessayer, ou repartir des données
        d’exemple si le problème persiste.
      </p>
      <p className="muted small">{error.message}</p>
      <div className="campaign-buttons">
        <button className="button button-primary" onClick={reset}>
          Réessayer
        </button>
        <button
          className="button button-secondary"
          onClick={() => {
            clearDemoStorage();
            // A full reload, not reset() or router.push(): the provider lives in
            // the layout, so only a remount re-reads the seeded state.
            window.location.reload();
          }}
        >
          Repartir des données d’exemple
        </button>
      </div>
    </main>
  );
}
