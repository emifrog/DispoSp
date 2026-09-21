"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BellOff, BellRing, Check, Send, Share, ShieldAlert, Smartphone } from "lucide-react";
import { applicationServerKey, vapidPublicKey } from "@/lib/push";
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

// §17 : l'application s'ajoute à l'écran d'accueil. Toujours aucune donnée
// conservée hors ligne ; les notifications poussées, elles, sont là — voir
// `PushNotifications` plus bas.
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
      <Panel title="Application installée" subtitle="DispoSP s’ouvre depuis votre écran d’accueil.">
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
          Sur iPhone et iPad : ouvrez DispoSP dans Safari, touchez le bouton Partager, puis «&nbsp;Sur l’écran
          d’accueil&nbsp;».
        </p>
      </div>
    </Panel>
  );
}

/* --- Notifications sur le téléphone ----------------------------------------
 *
 * L'abonnement appartient à l'appareil, pas au compte : un agent qui active ici
 * n'active que le téléphone qu'il tient. C'est voulu — le poste du centre ne
 * doit pas sonner la nuit parce qu'un agent a coché une case chez lui.
 *
 * Trois états seulement comptent pour lui : ça marche, c'est éteint, le
 * navigateur refuse. Le dernier ne se rattrape pas depuis une page web — une
 * autorisation refusée ne peut plus être redemandée, il faut passer par les
 * réglages du système. L'écran le dit plutôt que de proposer un bouton qui ne
 * ferait rien.
 */
type PushState = "checking" | "unsupported" | "blocked" | "off" | "on";

async function tellServer(method: "POST" | "DELETE", body: unknown): Promise<boolean> {
  const response = await fetch("/api/push/subscribe", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Le code exact, pas seulement « ça s'est bien passé » : une session expirée
  // fait renvoyer l'écran de connexion par le garde, et cette page-là répond
  // 200. L'appareil se croirait abonné sans que rien ne soit enregistré.
  return response.status === 204;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// Comme pour l'installation, le serveur ne peut pas savoir sur quoi il est lu :
// il répond « non », et le client rectifie à l'hydratation. C'est la seule
// plateforme qu'il faille reconnaître — elle est aussi la seule à refuser les
// notifications hors de l'application installée.
const useApple = () =>
  useSyncExternalStore(
    () => () => {},
    () => /iPad|iPhone|iPod/.test(navigator.userAgent),
    () => false,
  );

export function PushNotifications() {
  const key = vapidPublicKey();
  const standalone = useStandalone();
  const apple = useApple();
  const [state, setState] = useState<PushState>("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let abandoned = false;
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
        return setState("unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const subscription = await currentSubscription();
      if (abandoned) return;
      if (!subscription) return setState("off");
      setState("on");
      // Le serveur peut très bien ne pas connaître cet abonnement : le
      // navigateur a pu le renouveler seul, ou l'appareil a changé de main
      // depuis. Le redire à chaque passage coûte une requête et évite un
      // téléphone qui se croit abonné sans que rien ne lui soit jamais envoyé.
      await tellServer("POST", subscription.toJSON());
    })().catch(() => setState("off"));
    return () => {
      abandoned = true;
    };
  }, []);

  // Sans clé publique VAPID, aucun envoi n'est possible : proposer l'activation
  // ne mènerait qu'à une erreur. L'application se tait, comme elle le fait déjà
  // pour les emails quand Resend n'est pas configuré.
  if (!key) return null;

  async function enable() {
    setMessage("");
    // L'autorisation d'abord, avant toute attente : Safari ne l'accorde que si
    // la demande part du geste lui-même. Un `await` glissé avant la perdrait.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "blocked" : "off");
      return;
    }
    try {
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(key),
      });
      if (await tellServer("POST", subscription.toJSON())) {
        setState("on");
        setMessage("");
        return;
      }
      // Le navigateur est abonné mais le serveur l'ignore : le laisser ainsi
      // afficherait une case cochée qui n'apporterait jamais rien.
      await subscription.unsubscribe();
      setState("off");
      setMessage("L’activation n’a pas pu être enregistrée. Réessayez dans un moment.");
    } catch {
      setState("off");
      setMessage("Ce navigateur n’a pas pu créer l’abonnement. Réessayez, ou depuis l’application installée.");
    }
  }

  async function disable() {
    setMessage("");
    const subscription = await currentSubscription();
    if (subscription) {
      // Le serveur d'abord : une ligne oubliée en base continuerait de produire
      // des envois vers un appareil qui ne les attend plus.
      await tellServer("DELETE", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    setState("off");
  }

  async function test() {
    setMessage("");
    const response = await fetch("/api/push/test", { method: "POST" });
    // Ce qui revient n'est pas forcément du JSON : une session expirée ramène
    // l'écran de connexion, et le lire comme une réponse lèverait.
    const result = await response.json().catch(() => null as { sent?: number } | null);
    setMessage(
      result?.sent
        ? "Envoyée. Elle arrive dans quelques secondes, même écran éteint."
        : "L’essai n’est pas parti. L’abonnement de cet appareil n’est peut-être plus valable : désactivez puis réactivez.",
    );
  }

  const subtitle = {
    checking: "Vérification de cet appareil…",
    unsupported: "Cet appareil ne les reçoit pas.",
    blocked: "Le navigateur les a bloquées.",
    off: "Éteintes sur cet appareil.",
    on: "Actives sur cet appareil.",
  }[state];

  return (
    <Panel title="Notifications sur cet appareil" subtitle={subtitle}>
      {state === "on" ? (
        <>
          <div className="install-app">
            <BellRing size={20} />
            <p>
              Ouverture d’une campagne, rappel avant clôture, publication du planning et désistements arrivent sur cet
              appareil, même application fermée. Le message reste volontairement bref&nbsp;: un écran verrouillé se lit
              par-dessus l’épaule, aucun nom ni détail de garde n’y figure.
            </p>
          </div>
          <div className="install-buttons">
            <Button variant="secondary" onClick={test}>
              <Send size={16} />
              Envoyer un essai
            </Button>
            <Button variant="ghost" onClick={disable}>
              <BellOff size={16} />
              Désactiver
            </Button>
          </div>
        </>
      ) : state === "blocked" ? (
        <div className="install-app">
          <ShieldAlert size={20} />
          <p>
            Les notifications ont été refusées pour DispoSP. Une page ne peut plus les redemander&nbsp;: rouvrez-les
            dans les réglages du téléphone — Android&nbsp;: paramètres du navigateur, Notifications&nbsp;; iPhone&nbsp;:
            Réglages, Notifications, DispoSP — puis revenez ici.
          </p>
        </div>
      ) : state === "unsupported" && apple && !standalone ? (
        <div className="install-app">
          <Share size={20} />
          <p>
            Sur iPhone et iPad, les notifications n’existent que dans l’application installée. Ouvrez DispoSP dans
            Safari, touchez le bouton Partager, «&nbsp;Sur l’écran d’accueil&nbsp;», puis rouvrez-la depuis l’icône et
            revenez sur cette page.
          </p>
        </div>
      ) : state === "unsupported" ? (
        <div className="install-app muted">
          <BellOff size={20} />
          <p>
            Ce navigateur ne sait pas recevoir de notifications. Elles continuent d’arriver dans le centre de messages
            de l’application, et par email si votre adresse est renseignée.
          </p>
        </div>
      ) : (
        <>
          <div className="install-app">
            <BellRing size={20} />
            <p>
              Être prévenu sans ouvrir l’application&nbsp;: ouverture d’une campagne, rappel avant clôture, publication
              du planning, désistements. Le téléphone demandera son autorisation, et chaque appareil s’active
              séparément.
            </p>
          </div>
          {state === "off" && (
            <div className="install-buttons">
              <Button onClick={enable}>
                <BellRing size={16} />
                Activer les notifications
              </Button>
            </div>
          )}
        </>
      )}
      {message && (
        <div className="install-app muted small">
          <Check size={16} />
          <p>{message}</p>
        </div>
      )}
    </Panel>
  );
}
