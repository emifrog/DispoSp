"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BellOff, BellRing, Check, Download, Send, Share, ShieldAlert, Smartphone } from "lucide-react";
import {
  applicationServerKey,
  offersPush,
  pushAnswer,
  rememberPushAnswer,
  vapidPublicKey,
  type PushAnswer,
} from "@/lib/push";
import { Panel } from "./common";
import { useApp } from "./provider";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";

/** Propre à Chrome et à ses dérivés : ni les types du DOM ni Safari ne le
    connaissent, d'où la déclaration locale plutôt qu'un cast au clic. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };

declare global {
  interface Window {
    /** Posé par public/installation.js, chargé avant l'hydratation. */
    __dispospInstallation?: InstallPrompt | null;
  }
}

/* --- La proposition d'installation, partagée par tous les écrans ------------
 *
 * public/installation.js la retient dès le chargement de la page et prévient
 * par « disposp:installation ». Chaque bouton lit la même : le panneau du
 * profil, la barre du haut, l'écran de connexion. Elle survit aux navigations
 * internes — c'est la page qui la porte, pas un écran.
 */
const INSTALLATION = "disposp:installation";
const subscribeInstallation = (listener: () => void) => {
  window.addEventListener(INSTALLATION, listener);
  return () => window.removeEventListener(INSTALLATION, listener);
};
const useInstallOffer = () =>
  useSyncExternalStore(
    subscribeInstallation,
    () => window.__dispospInstallation ?? null,
    () => null,
  );

/**
 * Montre la fenêtre de Chrome. Une proposition ne sert qu'une fois : acceptée
 * ou refusée, elle est oubliée, et Chrome en annoncera une nouvelle s'il le
 * juge utile.
 */
async function install(offer: InstallPrompt) {
  try {
    await offer.prompt();
    await offer.userChoice;
  } finally {
    if (window.__dispospInstallation === offer) window.__dispospInstallation = null;
    window.dispatchEvent(new Event(INSTALLATION));
  }
}

/**
 * Le bouton compact, pour la barre du haut et l'écran de connexion. Il ne se
 * montre que lorsque Chrome propose vraiment l'installation, et jamais dans
 * l'application déjà installée.
 */
export function InstallButton({ className = "" }: { className?: string }) {
  const offer = useInstallOffer();
  const standalone = useStandalone();
  if (!offer || standalone) return null;
  return (
    <button
      type="button"
      className={`install-trigger ${className}`}
      aria-label="Installer l’application sur cet appareil"
      onClick={() => void install(offer)}
    >
      <Download size={17} aria-hidden="true" />
      <span>Installer</span>
    </button>
  );
}

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
  // La proposition vient de public/installation.js, retenue dès le chargement :
  // le panneau l'écoutait lui-même, et la manquait quand Chrome l'annonçait
  // avant que le profil ne s'affiche — c'est-à-dire presque toujours.
  const offer = useInstallOffer();
  const [justInstalled, setJustInstalled] = useState(false);
  const installed = useStandalone() || justInstalled;
  useEffect(() => {
    const done = () => setJustInstalled(true);
    window.addEventListener("appinstalled", done);
    return () => window.removeEventListener("appinstalled", done);
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
          <Button onClick={() => void install(offer)}>Installer l’application</Button>
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
//
// Depuis iPadOS 13, Safari se présente sur iPad comme un Mac de bureau : seul
// l'écran tactile l'en distingue — aucun Mac n'en a.
const useApple = () =>
  useSyncExternalStore(
    () => () => {},
    () =>
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
    () => false,
  );

/*
 * La réponse gardée sur l'appareil est une source extérieure à React — c'est
 * exactement ce qu'elle est, et le serveur ne la connaît pas. Elle se lit donc
 * comme la fenêtre ou le mode plein écran : un instantané, plus « non » au
 * premier rendu, celui que le serveur a déjà écrit. L'écrire prévient les deux
 * écrans qui en dépendent, sans quoi le panneau du profil et l'invitation
 * pourraient se contredire dans la même page.
 */
const answerListeners = new Set<() => void>();
function keepAnswer(userId: string, kept: PushAnswer) {
  rememberPushAnswer(userId, kept);
  for (const notify of answerListeners) notify();
}
const useRememberedAnswer = (userId: string) =>
  useSyncExternalStore(
    listener => {
      answerListeners.add(listener);
      return () => {
        answerListeners.delete(listener);
      };
    },
    () => pushAnswer(userId),
    () => null,
  );

/**
 * L'appareil, et ce qu'on peut en faire.
 *
 * Deux écrans s'en servent — le panneau du profil et l'invitation de la
 * connexion — et il ne peut y en avoir qu'une version : l'ordre des gestes
 * d'activation est ce qu'il y a de plus facile à défaire sans s'en apercevoir,
 * puisqu'un navigateur qui refuse ne dit rien de plus qu'un navigateur lent.
 *
 * Chaque geste mémorise la réponse. Activer répond « oui », désactiver et
 * décliner répondent « non » : l'invitation ne revient pas mendier à la
 * connexion suivante ce qui vient d'être décidé.
 */
function usePushDevice(userId: string) {
  const key = vapidPublicKey();
  const [state, setState] = useState<PushState>("checking");
  const answered = useRememberedAnswer(userId);
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
  }, [userId]);

  const answer = (kept: PushAnswer) => keepAnswer(userId, kept);

  /** Rend ce qui s'est réellement passé : l'appelant ne doit annoncer une
      activation que si elle a eu lieu, et la fenêtre d'invitation s'en sert. */
  async function enable(): Promise<boolean> {
    setMessage("");
    // L'autorisation d'abord, avant toute attente : Safari ne l'accorde que si
    // la demande part du geste lui-même. Un `await` glissé avant la perdrait.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      // Refuser la demande du système est une réponse, et elle est définitive
      // tant que l'agent ne rouvre pas les réglages de son téléphone.
      answer("non");
      setState(permission === "denied" ? "blocked" : "off");
      return false;
    }
    try {
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(key),
      });
      if (await tellServer("POST", subscription.toJSON())) {
        answer("oui");
        setState("on");
        setMessage("");
        return true;
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
    // Ni acceptée ni refusée : rien n'est gardé, la question pourra se reposer.
    return false;
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
    answer("non");
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

  return { key, state, answered, message, enable, disable, decline: () => answer("non"), test };
}

/**
 * L'invitation, une fois, à l'arrivée dans l'application.
 *
 * Une case à cocher dans un écran de réglages n'est trouvée que par qui la
 * cherche — or celui qu'il faut prévenir d'une campagne est justement celui qui
 * n'ouvre pas l'application. La question se pose donc d'elle-même, une seule
 * fois, et la réponse est gardée sur l'appareil.
 *
 * Fermer la fenêtre vaut refus, et c'est écrit dans la fenêtre : un agent qui
 * la balaie sans lire ne doit pas la retrouver à chaque connexion. Rien n'est
 * perdu pour autant — le profil garde le bouton, et la fenêtre le dit.
 */
export function PushInvitation({ userId }: { userId: string }) {
  const { key, state, answered, enable, decline } = usePushDevice(userId);
  const { notice } = useApp();
  const [open, setOpen] = useState(false);
  const offered = offersPush({
    configured: Boolean(key),
    supported: state !== "unsupported" && state !== "checking",
    permission: state === "blocked" ? "denied" : "default",
    subscribed: state === "on",
    answered,
  });

  useEffect(() => {
    if (!offered) return;
    // Le temps que l'écran s'affiche : une fenêtre qui arrive avec la page se
    // prend le geste destiné à autre chose, et se referme sans avoir été lue.
    const timer = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(timer);
  }, [offered]);

  if (!offered && !open) return null;

  async function accept() {
    const activated = await enable();
    setOpen(false);
    notice(
      activated
        ? "Notifications activées sur cet appareil."
        : "L’activation n’a pas abouti. Vous pouvez la reprendre depuis Mon profil.",
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={next => {
        if (next) return;
        // Fermer, c'est répondre non : sans cela la question reviendrait à
        // chaque connexion, et une application qui insiste finit refusée.
        decline();
        setOpen(false);
      }}
      title="Être prévenu sur cet appareil ?"
      description="Ouverture d’une campagne, rappel avant clôture, publication du planning, désistement : la notification arrive même application fermée."
    >
      <div className="install-app">
        <BellRing size={20} />
        <p>
          Vous pouvez revenir sur ce choix à tout moment depuis
          <strong> Mon profil</strong>.
        </p>
      </div>
      <div className="install-buttons">
        <Button onClick={accept}>
          <BellRing size={16} />
          Activer les notifications
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            decline();
            setOpen(false);
          }}
        >
          Non merci
        </Button>
      </div>
    </Modal>
  );
}

export function PushNotifications() {
  const { actor } = useApp();
  const standalone = useStandalone();
  const apple = useApple();
  const { key, state, message, enable, disable, test } = usePushDevice(actor.id);

  // Sans clé publique VAPID, aucun envoi n'est possible : proposer l'activation
  // ne mènerait qu'à une erreur. L'application se tait, comme elle le fait déjà
  // pour les emails quand Resend n'est pas configuré.
  if (!key) return null;

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
              Rappel avant clôture, publication du planning et désistements arrivent sur cet appareil, même application
              fermée. Le message reste volontairement bref&nbsp;: un écran verrouillé se lit par-dessus l’épaule, aucun
              nom ni détail de garde n’y figure.
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
