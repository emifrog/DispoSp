// The demonstration stays the default. Connected mode is opted into explicitly,
// so having Supabase credentials in the environment never silently locks the
// local demonstration or the end-to-end tests behind a login screen.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const isConnected =
  process.env.NEXT_PUBLIC_DISPOSP_MODE === "connected" && Boolean(supabaseUrl) && Boolean(supabaseKey);

export function credentials() {
  if (!supabaseUrl || !supabaseKey) throw new Error("Le projet Supabase n’est pas configuré.");
  return { url: supabaseUrl, key: supabaseKey };
}

export const SIGN_IN_PATH = "/connexion";
export const SIGN_OUT_PATH = "/deconnexion";
export const HOME_PATH = "/tableau-de-bord";
// Signing out must stay reachable without a session: otherwise the guard
// intercepts the request and the sign-out never runs.
export const publicPaths = [SIGN_IN_PATH, SIGN_OUT_PATH];
