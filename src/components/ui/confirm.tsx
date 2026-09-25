"use client";
import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./dialog";

/** Ce qu'une confirmation demande : de quoi dire le geste, et le geste lui-même. */
export type Confirmation = {
  title: string;
  description: string;
  /** Le libellé du bouton qui agit : le verbe du geste, jamais « OK ». */
  confirmLabel: string;
  /** Un geste qui retire ou écarte quelqu'un : le bouton prend le rouge. */
  danger?: boolean;
  onConfirm: () => unknown;
};

/**
 * Une confirmation avant un geste qui ne se défait pas d'un clic.
 *
 * Verrouiller une campagne, trancher un désistement, remplacer les besoins d'un
 * mois : chacun prévient ou écrase, et un clic égaré n'a pas de retour. Une
 * seule boîte pour tous, bâtie sur la `Modal` des autres écrans.
 *
 * Le crochet rend la fonction qui la demande et l'élément à poser dans l'écran.
 * La boîte appelle le geste elle-même : c'est son bouton qui attend pendant
 * l'écriture, et elle ne se ferme qu'une fois l'écriture finie — refusée ou
 * non, le message de l'application dit ce qu'il en est.
 */
export function useConfirmation(): [(confirmation: Confirmation) => void, ReactNode] {
  const [shown, setShown] = useState<Confirmation | null>(null);
  // Le contenu reste en place pendant la fermeture : effacé en même temps que
  // `open`, le titre disparaissait avant la boîte.
  const [open, setOpen] = useState(false);
  const ask = (confirmation: Confirmation) => {
    setShown(confirmation);
    setOpen(true);
  };
  const element = shown ? (
    <Modal open={open} onOpenChange={setOpen} title={shown.title} description={shown.description}>
      <div className="confirm-buttons">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Annuler
        </Button>
        <Button
          variant={shown.danger ? "danger" : "default"}
          onClick={async () => {
            await shown.onConfirm();
            setOpen(false);
          }}
        >
          {shown.confirmLabel}
        </Button>
      </div>
    </Modal>
  ) : null;
  return [ask, element];
}
