import type { MetadataRoute } from "next";

// Le manifeste rend l'application installable sur l'écran d'accueil d'un
// téléphone (§17). Il ne change rien à ce qu'elle fait : c'est la même
// application, ouverte sans la barre d'adresse du navigateur.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DISPO SP — Disponibilités & planning",
    short_name: "DISPO SP",
    description: "La disponibilité de chacun, la force du collectif.",
    lang: "fr",
    dir: "ltr",
    // La racine décide seule où envoyer : connexion si la session manque,
    // tableau de bord sinon. Un raccourci figé vers un écran interne
    // afficherait une redirection à chaque ouverture.
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Le fond du premier écran, pour qu'il n'y ait pas d'éclair blanc au
    // lancement ; la teinte est celle de la barre d'état.
    background_color: "#f6f8fc",
    theme_color: "#142b50",
    // Surtout pas de verrouillage : la matrice mensuelle se lit en paysage.
    orientation: "any",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android découpe l'icône à sa guise : la version « maskable » garde la
      // flamme dans le cercle de sécurité, quel que soit le masque du système.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Mes disponibilités", short_name: "Mes dispos", url: "/mes-disponibilites" },
      { name: "Mon planning", short_name: "Planning", url: "/mon-planning" },
    ],
  };
}
