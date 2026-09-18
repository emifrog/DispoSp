"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { submitCommand } from "@/app/actions";
import { execute, stateSchema, type Agent, type AppState, type Campaign, type Command, type Actor } from "@/lib/domain";
import { createDemoState } from "@/lib/seed";
import { ACTOR_KEY, STATE_KEY } from "@/lib/storage";

type Context = {
  state: AppState;
  actor: Actor;
  /** The selected campaign, already resolved: consumers never look it up again. */
  campaign: Campaign;
  /** The agent behind the current demonstration profile, already resolved. */
  agent: Agent;
  campaignId: string;
  setCampaignId: (id: string) => void;
  switchRole: (role: Actor["role"]) => void;
  selectAgent: (id: string) => void;
  /** Resolves once the write is settled: connected mode waits for the database. */
  run: (command: Command) => Promise<boolean>;
  notice: (text: string) => void;
  ready: boolean;
  /** True when the screens read the database. Demonstration-only controls and
      wording must be hidden behind it: on real data they would be a lie. */
  connected: boolean;
};
const Store = createContext<Context | null>(null);
export function AppProvider({
  children,
  initialState,
  initialActor,
}: {
  children: ReactNode;
  /** Connected mode passes the state read from the database; demonstration passes nothing. */
  initialState?: AppState;
  initialActor?: Actor;
}) {
  const connected = Boolean(initialState);
  // Connected mode renders the server's copy directly. Holding it in useState
  // would freeze it at mount: the initialiser never runs again, so everything
  // router.refresh() brings back after a write would be silently ignored.
  const [localState, setLocalState] = useState<AppState>(() => initialState ?? createDemoState());
  const state = initialState ?? localState;
  const [actor, setActor] = useState<Actor>(initialActor ?? { id: "julien", role: "MANAGER" });
  const [campaignId, setCampaignId] = useState(() => state.campaigns[0]?.id ?? "");
  const [ready, setReady] = useState(connected);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const path = usePathname();
  // Restoring the demonstration from browser storage can only happen after mount:
  // the server render has no localStorage. This is the one effect allowed to set state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (connected) return;
    try {
      const saved = localStorage.getItem(STATE_KEY);
      if (saved) {
        const result = stateSchema.safeParse(JSON.parse(saved));
        // A state without agents or campaigns passes the schema but has no screen
        // to show; keep the seeded demonstration rather than render an empty shell.
        if (result.success && result.data.campaigns.length && result.data.agents.length) {
          setLocalState(result.data);
          // A saved state predates today's demonstration window, so its campaigns
          // are not the ones just seeded: point at one it actually contains.
          setCampaignId(id => (result.data.campaigns.some(c => c.id === id) ? id : result.data.campaigns[0].id));
        } else setMessage("La sauvegarde locale n’est pas compatible. Les données d’exemple sont affichées.");
      }
      const session = sessionStorage.getItem(ACTOR_KEY);
      if (session) {
        const parsed = JSON.parse(session);
        if (
          (parsed.role === "AGENT" || parsed.role === "MANAGER") &&
          createDemoState().agents.some(a => a.id === parsed.id)
        )
          setActor(parsed);
      }
    } catch {
      setMessage("La sauvegarde locale n’a pas pu être lue. Les données d’exemple sont affichées.");
    }
    setReady(true);
  }, [connected]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(timer);
  }, [message]);
  async function run(command: Command): Promise<boolean> {
    // Connected mode writes to the database. Falling back to localStorage on a
    // refusal would silently drop the change and fake a success.
    if (connected) {
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
    try {
      const next = execute(state, actor, command);
      // Save first: do not announce success if storage is blocked or full.
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
      setLocalState(next);
      setMessage(next.audit[0].action + ".");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "L’action n’a pas pu être enregistrée.");
      return false;
    }
  }
  function switchRole(role: Actor["role"]) {
    sessionStorage.setItem(ACTOR_KEY, JSON.stringify({ ...actor, role }));
    setActor(a => ({ ...a, role }));
    if (role === "AGENT") router.push("/mes-disponibilites");
    else if (path.startsWith("/mes-") || path === "/profil") router.push("/tableau-de-bord");
  }
  // Resolved once here so no screen has to assert that a lookup succeeded. Both
  // lists are non-empty: the seed fills them and the restore path above rejects
  // any saved state that does not.
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
        switchRole,
        selectAgent: id => {
          sessionStorage.setItem(ACTOR_KEY, JSON.stringify({ ...actor, id }));
          setActor(a => ({ ...a, id }));
        },
        run,
        notice: setMessage,
        ready,
        connected,
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
