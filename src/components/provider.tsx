"use client";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { submitCommand } from "@/app/actions";
import {
  administers,
  type Actor,
  type Agent,
  type AppState,
  type Campaign,
  type Command,
  type MemberRole,
} from "@/lib/domain";

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
  // Deliberately not held in useState: the initialiser never runs again, so
  // everything router.refresh() brings back after a write would be ignored.
  const [campaignId, setCampaignId] = useState(() => state.campaigns[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const router = useRouter();
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6500);
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
  // Un état plutôt qu'une simple lecture de `submitting` : deux clics dans le
  // même cycle de rendu liraient tous deux « faux » et enverraient deux
  // commandes, dont la seconde buterait sur ce que la première a changé.
  const running = useRef(false);

  async function run(command: Command): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setSubmitting(true);
    try {
      const result = await submitCommand(command);
      if (!result.ok) {
        setMessage(result.message);
        return false;
      }
      // The screens are built by the server render: re-read the database rather
      // than patch a local copy of what we believe was just written.
      startRefresh(() => router.refresh());
      setMessage(result.label + ".");
      return true;
    } catch {
      // L'action serveur n'a pas répondu — réseau coupé, déploiement en cours.
      // On ignore si l'écriture a eu lieu, et le dire vaut mieux que de laisser
      // l'écran figé sur une attente qui ne finira pas.
      setMessage("La connexion a été interrompue. Vérifiez l’écran avant de recommencer.");
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
        notice: setMessage,
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
      {message && (
        <div className="toast" role="status">
          {message}
          <button aria-label="Masquer le message" onClick={() => setMessage("")}>
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
