"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Share, Smartphone } from "lucide-react";
import { Panel } from "./common";
import { Button } from "./ui/button";

/** Propre à Chrome et à ses dérivés : ni les types du DOM ni Safari ne le
    connaissent, d'où la déclaration locale plutôt qu'un cast au clic. */
type InstallPrompt = Event & { prompt: () => Promise<void> };

export function ServiceWorker() {
  useEffect(() => {
    // En développement, un agent de service enregistré survit aux
    // rechargements et brouille la lecture de ce qui vient du serveur.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // Après le chargement : son installation ne doit pas disputer la bande
    // passante au premier rendu, qui est celui que l'agent attend.
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}

// Le navigateur sait déjà s'il affiche l'application installée ou un onglet.
// Le serveur, lui, ne peut pas le savoir : il répond « non » pour que le
// premier rendu du client corresponde au sien.
const STANDALONE = "(display-mode: standalone)";
const useStandalone = () =>
  useSyncExternalStore(
    listener => {
      const query = window.matchMedia(STANDALONE);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(STANDALONE).matches,
    () => false,
  );

// §17 : l'application s'ajoute à l'écran d'accueil. Rien de plus — ni données
// hors ligne, ni notifications poussées, qui relèvent de la V2.
export function InstallApp() {
  const [offer, setOffer] = useState<InstallPrompt | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);
  const installed = useStandalone() || justInstalled;
  useEffect(() => {
    const keep = (event: Event) => {
      // Sans cela, le navigateur affiche sa propre invite, au moment qu'il
      // choisit et par-dessus l'écran en cours.
      event.preventDefault();
      setOffer(event as InstallPrompt);
    };
    const done = () => {
      setOffer(null);
      setJustInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", keep);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  if (installed)
    return (
      <Panel title="Application installée" subtitle="DISPO SP s’ouvre depuis votre écran d’accueil.">
        <div className="install-app">
          <Check size={20} />
          <p>
            Vous utilisez la version installée. Elle affiche les mêmes données que le navigateur, lues en direct : il
            n’y a pas de copie locale à rafraîchir.
          </p>
        </div>
      </Panel>
    );
  return (
    <Panel
      title="Installer l’application"
      subtitle="Un accès direct depuis l’écran d’accueil, sans passer par le navigateur."
    >
      <div className="install-app">
        <Smartphone size={20} />
        <p>
          L’application s’ouvre alors en plein écran, sans barre d’adresse. Elle a toujours besoin du réseau : rien
          n’est conservé sur l’appareil, pour qu’aucun planning périmé ne puisse être présenté comme à jour.
        </p>
      </div>
      {offer && (
        <div className="install-buttons">
          <Button onClick={() => void offer.prompt()}>Installer l’application</Button>
        </div>
      )}
      {/* Safari n'annonce jamais la possibilité d'installer : sur iPhone, le
          chemin se dit, il ne se propose pas. */}
      <div className="install-app muted small">
        <Share size={16} />
        <p>
          Sur iPhone et iPad : ouvrez DISPO SP dans Safari, touchez le bouton Partager, puis «&nbsp;Sur l’écran
          d’accueil&nbsp;».
        </p>
      </div>
    </Panel>
  );
}
