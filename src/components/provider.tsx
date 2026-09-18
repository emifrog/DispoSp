"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { execute, stateSchema, type AppState, type Command, type Actor } from "@/lib/domain";
import { createDemoState } from "@/lib/seed";

const STORAGE_KEY = "disposp-demo-v1";
type Context = {
  state: AppState;
  actor: Actor;
  campaignId: string;
  setCampaignId: (id: string) => void;
  switchRole: (role: Actor["role"]) => void;
  selectAgent: (id: string) => void;
  run: (command: Command) => boolean;
  notice: (text: string) => void;
  ready: boolean;
};
const Store = createContext<Context | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(createDemoState);
  const [actor, setActor] = useState<Actor>({ id: "julien", role: "MANAGER" });
  const [campaignId, setCampaignId] = useState("campaign-2026-10");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const path = usePathname();
  // Restoring the demonstration from browser storage can only happen after mount:
  // the server render has no localStorage. This is the one effect allowed to set state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const result = stateSchema.safeParse(JSON.parse(saved));
        if (result.success) setState(result.data);
        else setMessage("La sauvegarde locale n’est pas compatible. Les données d’exemple sont affichées.");
      }
      const session = sessionStorage.getItem("disposp-demo-actor");
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
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(timer);
  }, [message]);
  function run(command: Command) {
    try {
      const next = execute(state, actor, command);
      // Save first: do not announce success if storage is blocked or full.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setState(next);
      setMessage(next.audit[0].action + ".");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "L’action n’a pas pu être enregistrée.");
      return false;
    }
  }
  function switchRole(role: Actor["role"]) {
    sessionStorage.setItem("disposp-demo-actor", JSON.stringify({ ...actor, role }));
    setActor(a => ({ ...a, role }));
    if (role === "AGENT") router.push("/mes-disponibilites");
    else if (path.startsWith("/mes-") || path === "/profil") router.push("/tableau-de-bord");
  }
  return (
    <Store.Provider
      value={{
        state,
        actor,
        campaignId,
        setCampaignId,
        switchRole,
        selectAgent: id => {
          sessionStorage.setItem("disposp-demo-actor", JSON.stringify({ ...actor, id }));
          setActor(a => ({ ...a, id }));
        },
        run,
        notice: setMessage,
        ready,
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
