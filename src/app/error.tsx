"use client";
import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Tout ce que les écrans affichent vient de la base, relue à chaque navigation :
// un écran qui ne s'affiche pas se retente, il n'y a rien de local à jeter.
//
// `retry` et non `reset` : l'erreur typique vient du serveur — une lecture de la
// base qui a échoué —, et `reset` réaffichait le segment sans rien relire, donc
// sur la même erreur. `retry` relit, puis réaffiche (Next 16.3, voir
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
//
// En production, le message d'une erreur venue du serveur est remplacé par une
// phrase anglaise générique ; seule sa référence (`digest`) est utile, pour
// retrouver la cause dans le journal du serveur. Une erreur née dans le
// navigateur n'a pas de référence, et son message, lui, est le vrai.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="empty-state" id="main">
      <h1>Cet écran n’a pas pu s’afficher.</h1>
      <p>Aucune donnée n’est perdue : elles sont conservées en base et relues à chaque affichage.</p>
      <p className="muted small">
        {error.digest ? `Référence de l’erreur : ${error.digest}` : `Détail : ${error.message}`}
      </p>
      <Button onClick={() => retry()}>
        <RotateCw size={16} />
        Réessayer
      </Button>
    </main>
  );
}
