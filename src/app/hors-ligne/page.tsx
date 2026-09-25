import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Hors ligne" };

// La seule page que l'agent de service garde en mémoire. Elle ne contient
// aucune donnée : c'est ce qui lui permet de ne jamais être périmée.
//
// Et elle se suffit à elle-même. Hors ligne, rien d'autre que ce document ne
// se charge : ni la feuille de style de l'application, ni le code qui
// hydraterait un bouton. Elle porte donc ses propres styles, en ligne, et son
// « Réessayer » est un simple lien — un rechargement complet, que le
// navigateur sait faire sans aucun script : `Link` rend une ancre ordinaire,
// qui navigue même quand rien ne s'est hydraté. La page s'affichait sans style,
// avec un bouton qui ne faisait rien.
//
// Claire, toujours, comme l'application, qui n'a pas de thème sombre. Une règle
// « prefers-color-scheme: dark » y passait le texte en clair sur un fond resté
// clair : 1,1:1, illisible sur un téléphone réglé en sombre. Le fond et
// `color-scheme` sont donc posés ici, pour ne rien laisser au navigateur.
const styles = `
  .offline { max-width: 32rem; margin: 18vh auto 0; padding: 0 24px; font-family: Roboto, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d2a3a; line-height: 1.55; }
  .offline h1 { font-size: 1.45rem; font-weight: 600; margin: 0 0 12px; color: #08284a; }
  .offline p { margin: 0 0 12px; font-size: 15px; }
  .offline a { display: inline-block; margin-top: 10px; padding: 12px 20px; min-height: 24px; border-radius: 9px; background: #08284a; color: #fff; text-decoration: none; font-weight: 500; }
  .offline a:focus-visible { outline: 3px solid #1668dc; outline-offset: 2px; }
  :root { color-scheme: light; }
  body { margin: 0; background: #f6f8fc; }
`;

export default function Offline() {
  return (
    <main className="offline">
      <style>{styles}</style>
      <h1>Pas de connexion.</h1>
      <p>
        DispoSP a besoin du réseau : les disponibilités, les affectations et les plannings sont lus en direct, jamais
        depuis une copie qui pourrait dater.
      </p>
      <p>Rétablissez la connexion, puis réessayez.</p>
      {/* Sans préchargement. Next précharge un lien visible en production, et
          laisse sans le lire le corps d'une réponse qui n'est pas la sienne —
          l'erreur de la racine sans configuration, la page de connexion vers
          laquelle le garde la redirige. Le navigateur tient alors la requête
          pour ouverte, et la page n'est jamais « chargée » : le test de
          politique de contenu attendait ce moment, et l'intégration continue
          est restée rouge du 23 au 25 septembre. Ici, rien à précharger : on
          revient quand le réseau revient. */}
      <Link href="/" prefetch={false}>
        Réessayer
      </Link>
    </main>
  );
}
