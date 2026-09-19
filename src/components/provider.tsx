"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  async function run(command: Command): Promise<boolean> {
    const result = await submitCommand(command);
    if (!result.ok) {
      setMessage(result.message);
      return false;
    }
    // The screens are built by the server render: re-read the database rather
    // than patch a local copy of what we believe was just written.
    router.refresh();
    setMessage(result.label + ".");
    return true;
  }
  // Resolved once here so no screen has to assert that a lookup succeeded. The
  // workspace layout has already turned away a centre without campaigns.
  const campaign = state.campaigns.find(c => c.id === campaignId) ?? state.campaigns[0];
  const agent = state.agents.find(a => a.id === actor.id) ?? state.agents[0];
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
        notice: setMessage,
        memberRole,
        canAdminister: administers(memberRole),
      }}
    >
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
