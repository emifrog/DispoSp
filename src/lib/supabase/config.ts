// Une seule façon de tourner : branchée sur Supabase. Il n'existe plus de
// variable de mode, donc plus de déploiement capable d'afficher silencieusement
// des données d'exemple à la place des vraies.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function credentials() {
  if (!supabaseUrl || !supabaseKey) throw new Error("Le projet Supabase n’est pas configuré.");
  return { url: supabaseUrl, key: supabaseKey };
}

export const SIGN_IN_PATH = "/connexion";
export const SIGN_OUT_PATH = "/deconnexion";
export const HOME_PATH = "/tableau-de-bord";
// Ce que le garde ne doit jamais intercepter.
//
// La déconnexion, sans quoi elle ne pourrait jamais s'exécuter. Et ce qu'un
// navigateur va chercher avant toute session : le manifeste et l'agent de
// service — une application dont le manifeste répond une redirection ne
// s'installe pas — plus la page hors ligne, que l'agent de service met en cache
// à l'installation.
export const publicPaths = [SIGN_IN_PATH, SIGN_OUT_PATH, "/manifest.webmanifest", "/sw.js", "/hors-ligne"];
