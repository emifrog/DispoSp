// Une seule façon de tourner : branchée sur Supabase. Il n'existe plus de
// variable de mode, donc plus de déploiement capable d'afficher silencieusement
// des données d'exemple à la place des vraies.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Sans les deux valeurs, l'application ne peut rien lire. Le savoir sans lever
    permet de servir malgré tout ce qui ne demande aucune donnée. */
export const configured = () => Boolean(supabaseUrl && supabaseKey);
export function credentials() {
  if (!supabaseUrl || !supabaseKey) throw new Error("Le projet Supabase n’est pas configuré.");
  return { url: supabaseUrl, key: supabaseKey };
}

export const SIGN_IN_PATH = "/connexion";
export const SIGN_OUT_PATH = "/deconnexion";
// La racine, pas un écran : c'est elle qui aiguille selon le rôle — accueil
// pour un agent, tableau de bord pour qui encadre.
export const HOME_PATH = "/";
// Ce que le garde ne doit jamais intercepter.
//
// La déconnexion, sans quoi elle ne pourrait jamais s'exécuter. Et ce qu'un
// navigateur va chercher avant toute session : le manifeste et l'agent de
// service — une application dont le manifeste répond une redirection ne
// s'installe pas — plus la page hors ligne, que l'agent de service met en cache
// à l'installation.
// Le choix d'un nouveau mot de passe et la vérification du lien qui y mène
// doivent passer le garde : on y arrive précisément sans session, et les y
// soumettre renverrait l'agent vers la connexion — l'écran même qu'il ne peut
// pas franchir.
//
// Le rattrapage des envois poussés, enfin : un planificateur externe n'a pas
// de cookie, il porte un jeton. Le garde le renvoyait vers la connexion et la
// route, avec sa vérification du jeton, ne s'exécutait jamais.
export const publicPaths = [
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  "/nouveau-mot-de-passe",
  "/auth/recuperation",
  "/activation",
  "/auth/activation",
  "/manifest.webmanifest",
  "/sw.js",
  "/hors-ligne",
  "/api/push/dispatch",
];
