"use client";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { submitCommand } from "@/app/actions";
import {
  administers,
  defaultCampaign,
  type Actor,
  type Agent,
  type AppState,
  type Campaign,
  type Command,
  type MemberRole,
} from "@/lib/domain";
import { CAMPAIGN_PARAM } from "@/lib/campaign-param";

type Context = {
  state: AppState;
  actor: Actor;
  /** The selected campaign, already resolved: consumers never look it up again. */
  campaign: Campaign;
  /** The signed-in agent's own record, already resolved. */
  agent: Agent;
  campaignId: string;
  setCampaignId: (id: string) => void;
  /** Resolves once the write is settled, that is once the database has answered. */
  run: (command: Command) => Promise<boolean>;
  /** Une écriture est en cours, ou l'écran se relit après elle. */
  busy: boolean;
  notice: (text: string) => void;
  /** The §2 role as the database holds it. */
  memberRole: MemberRole;
  /** Gates the administration controls. The database decides for real; this only
      keeps a screen from offering what it would refuse. */
  canAdminister: boolean;
};
const Store = createContext<Context | null>(null);
export function AppProvider({
  children,
  state,
  actor,
  memberRole,
}: {
  children: ReactNode;
  /** Read from the database by the server render, on every navigation. */
  state: AppState;
  actor: Actor;
  memberRole: MemberRole;
}) {
  // `state` itself is deliberately not held in useState: the initialiser never
  // runs again, so everything router.refresh() brings back after a write would
  // be ignored. Only the selection below is client state.
  //
  // La campagne choisie vit dans l'adresse (`?campagne=`), et c'est ce qui la
  // fait survivre à un rechargement, à un lancement depuis l'écran d'accueil ou
  // à une bulle de notification. Sans elle, on ne prend pas la première de la
  // liste — la plus ancienne du centre — mais celle qui attend une réponse.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get(CAMPAIGN_PARAM);
  const [campaignId, setCampaignId] = useState(
    () => (asked && state.campaigns.some(c => c.id === asked) ? asked : defaultCampaign(state.campaigns)?.id) ?? "",
  );
  // L'adresse suit la sélection, sur chaque écran : les liens internes ne la
  // portent pas, et un rechargement depuis eux retomberait sinon sur le défaut.
  // `replaceState` plutôt que le routeur : rien à recharger, la sélection est
  // déjà là ; Next lit ce que l'historique reçoit et `useSearchParams` suit.
  useEffect(() => {
    if (!campaignId || params.get(CAMPAIGN_PARAM) === campaignId) return;
    const next = new URLSearchParams(params);
    next.set(CAMPAIGN_PARAM, campaignId);
    window.history.replaceState(window.history.state, "", `${pathname}?${next}`);
  }, [campaignId, pathname, params]);
  // Un succès s'efface seul ; une erreur reste jusqu'à ce qu'on l'ait lue. Un
  // refus de la base avec son explication disparaissait en six secondes, avec la
  // même tête qu'une confirmation.
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const notice = (text: string) => setMessage({ text, kind: "ok" });
  const complain = (text: string) => setMessage({ text, kind: "error" });
  useEffect(() => {
    if (!message || message.kind !== "ok") return;
    const timer = setTimeout(() => setMessage(null), 6500);
    return () => clearTimeout(timer);
  }, [message]);
  /**
   * L'attente se joue en deux temps, et l'agent doit la voir entière.
   *
   * L'action serveur d'abord, puis la relecture qu'elle déclenche — c'est elle
   * qui redessine l'écran, et depuis la pagination elle lit tout le centre.
   * `router.refresh()` ne dit pas quand il a fini ; enveloppé dans une
   * transition, il le dit. Sans cela l'indicateur s'éteindrait à la réponse du
   * serveur, alors que l'écran montre encore les anciennes données.
   */
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  // Une campagne archivée n'arrive qu'avec sa liste de participants : son
  // détail ne se lit que si l'adresse la demande. Une fois l'adresse à jour —
  // `params` le dit —, on relit l'état. Une seule demande en attente par
  // campagne : si la relecture ne l'apportait pas, on ne bouclerait pas. La
  // demande s'efface quand la campagne arrive chargée, pour qu'un retour vers
  // elle, après qu'une écriture l'a déchargée, la relise.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const selected = state.campaigns.find(c => c.id === campaignId);
    if (!selected) return;
    if (selected.loaded) {
      requested.current.delete(campaignId);
      return;
    }
    if (params.get(CAMPAIGN_PARAM) !== campaignId || requested.current.has(campaignId)) return;
    requested.current.add(campaignId);
    startRefresh(() => router.refresh());
  }, [campaignId, params, state.campaigns, router]);
  // Un état plutôt qu'une simple lecture de `submitting` : deux clics dans le
  // même cycle de rendu liraient tous deux « faux » et enverraient deux
  // commandes, dont la seconde buterait sur ce que la première a changé.
  const running = useRef(false);

  async function run(command: Command): Promise<boolean> {
    // Un second clic pendant une écriture n'en déclenche pas une seconde, et
    // le dit : ignoré en silence, deux « + » rapides n'affectaient qu'un agent
    // sans que rien ne le montre.
    if (running.current) {
      complain("Une action est déjà en cours. Attendez qu’elle se termine, puis recommencez.");
      return false;
    }
    running.current = true;
    setSubmitting(true);
    try {
      const result = await submitCommand(command);
      if (!result.ok) {
        complain(result.message);
        // L'écran se relit aussi après un refus : la base a souvent refusé
        // parce que quelqu'un d'autre a changé ce que l'écran montre encore, et
        // chaque nouvel essai échouerait à l'identique jusqu'à une navigation.
        startRefresh(() => router.refresh());
        return false;
      }
      // The screens are built by the server render: re-read the database rather
      // than patch a local copy of what we believe was just written.
      startRefresh(() => router.refresh());
      notice(result.label + ".");
      return true;
    } catch {
      // L'action serveur n'a pas répondu — réseau coupé, déploiement en cours.
      // On ignore si l'écriture a eu lieu : on relit, et on le dit — c'est
      // mieux que de laisser l'écran figé sur une attente qui ne finira pas.
      complain("La connexion a été interrompue. L’écran a été relu : vérifiez-le avant de recommencer.");
      startRefresh(() => router.refresh());
      return false;
    } finally {
      running.current = false;
      setSubmitting(false);
    }
  }
  // Resolved once here so no screen has to assert that a lookup succeeded. The
  // workspace layout has already turned away a centre without campaigns.
  const campaign = state.campaigns.find(c => c.id === campaignId) ?? state.campaigns[0];
  const agent = state.agents.find(a => a.id === actor.id) ?? state.agents[0];
  const busy = submitting || refreshing;
  return (
    <Store.Provider
      value={{
        state,
        actor,
        campaign,
        agent,
        campaignId,
        setCampaignId,
        run,
        busy,
        notice,
        memberRole,
        canAdminister: administers(memberRole),
      }}
    >
      {/* Une barre en haut de l'écran plutôt qu'un voile : l'agent continue de
          lire ce qu'il a sous les yeux, et sait qu'on travaille. `aria-live`
          l'annonce une fois, sans répéter à chaque rendu. */}
      {busy && (
        <div className="busy-bar" role="status" aria-live="polite">
          <span className="sr-only">Enregistrement en cours…</span>
        </div>
      )}
      {children}
      {/* `alert` pour une erreur : le lecteur d'écran l'annonce tout de suite ;
          `status` pour une confirmation, qui peut attendre la fin de la phrase. */}
      {message && (
        <div
          className={`toast ${message.kind === "error" ? "error" : ""}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.kind === "error" && <TriangleAlert size={18} aria-hidden="true" />}
          {message.text}
          <button aria-label="Masquer le message" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}
    </Store.Provider>
  );
}
export function useApp() {
  const value = useContext(Store);
  if (!value) throw new Error("AppProvider manquant");
  return value;
}
