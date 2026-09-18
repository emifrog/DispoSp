# DISPO SP

Première tranche de développement de l'application de disponibilités et de planification des sapeurs-pompiers.

## Démarrer

Prérequis : Node.js 22 et pnpm. Les versions des dépendances et le fichier de verrouillage sont enregistrés.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir http://127.0.0.1:3000. Pour vérifier une version de production : `pnpm build`, puis `pnpm start`.

L'application démarre avec une **démonstration locale clairement identifiée** : douze agents fictifs et une campagne calculée à partir de la date du jour. Les réponses sont collectées pendant le mois en cours, pour le mois suivant ; la démonstration est donc toujours ouverte à la saisie, quel que soit le jour où elle est lancée. Les informations sont conservées dans le navigateur, sous `disposp-demo-v1`. Le profil de démonstration est conservé dans la session du navigateur. Aucun compte réel, email, appel métier distant ou paiement n'est créé.

## Parcours livrés

- Tableau de bord avec distinction entre couverture potentielle (réponses validées) et planifiée (brouillon).
- Calendrier agent : cinq états, sélection multiple, saisie par période ou jours de semaine, commentaire, remise à non renseigné.
- Validation explicite d'une campagne complète ; invalidation après modification ; verrouillage après clôture.
- Tableau de synthèse avec colonne agent fixe, tri par nom, recherche, filtres équipe/validation et totaux cohérents avec les lignes affichées.
- Construction du planning par date et par créneau : affectation/retrait, besoins d'effectifs et de qualifications, répartition des gardes.
- Publication par créneau avec contrôle de couverture et version indépendante du brouillon.
- Planning personnel limité aux affectations publiées ; export ICS tenant compte du fuseau Europe/Paris et des changements d'heure.
- Campagnes : création, sélection, verrouillage ; paramètres horaires appliqués aux nouvelles campagnes.
- Annuaire des agents fictifs, choix du profil de démonstration, historique local des actions et export CSV de la synthèse filtrée.
- Interface adaptée aux ordinateurs et téléphones ; dialogues accessibles au clavier.

## Règles retenues

Voir `DECISIONS_FONCTIONNELLES.md`. Jour 8 h–20 h, Nuit 20 h–8 h le lendemain, nuit rattachée à sa date de début. Une disponibilité 24 h couvre ces deux créneaux sans créer d'affectation. Les hypothèses supplémentaires de cette première tranche sont identifiées dans le document.

## Architecture

- Next.js App Router, React et TypeScript strict.
- Tailwind CSS, composants Button/Dialog sur les primitives shadcn/Radix, icônes Lucide.
- TanStack Table pour la synthèse, virtualisée par TanStack Virtual : à 300 agents, environ 25 lignes sont rendues au lieu de 300, et les totaux du pied de tableau portent toujours sur l'ensemble des agents filtrés.
- React Hook Form et Zod pour les campagnes et la validation du stockage.
- `src/lib/domain.ts` : règles métier pures, calculs de couverture et commandes testables.
- `src/components/provider.tsx` : stockage local de démonstration. **Les rôles du navigateur ne constituent pas un contrôle de sécurité.**
- `src/lib/exports.ts` : exports CSV et ICS.
- `src/lib/supabase/` : fabriques de clients, middleware de session et détection du mode. Inactives en démonstration.
- `src/lib/session.ts` et `src/lib/session.server.ts` : types partagés d'un côté, lecture de session de l'autre. La séparation est nécessaire — un composant client qui importerait `next/headers` casse la compilation.
- `supabase/migrations/` : 17 tables couvrant organisations, équipes, profils, droits, campagnes, participants, disponibilités, qualifications, créneaux types, besoins d'effectifs et de qualifications, plannings, affectations, notifications et audit. Isolation RLS, validation, invalidation et publication contrôlées en base.
- `.github/workflows/ci.yml` : formatage, lint, types, tests unitaires et schéma, build et tests de bout en bout à chaque push et chaque pull request.

## Raccordement Supabase restant à réaliser

Le projet de développement dédié est désigné : ses coordonnées sont dans `.env`, qui n'est pas versionné. En mode connecté, l'URL et la clé publiable sont incluses dans le paquet livré au navigateur — c'est le fonctionnement prévu de ces deux valeurs, la clé publiable ne donne accès qu'à ce que les policies RLS autorisent. Aucune clé secrète n'est nécessaire côté client.

### Migrations

Le schéma est découpé en migrations successives, à appliquer dans l'ordre et une seule fois chacune :

| Fichier                                   | Contenu                                                                                | État                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `supabase/migrations/0001_foundation.sql` | Organisations, équipes, profils, droits, campagnes, participants, disponibilités       | Appliquée le 18 septembre 2026 |
| `supabase/migrations/0002_planning.sql`   | Qualifications, créneaux types, besoins, plannings, affectations, notifications, audit | Appliquée le 18 septembre 2026 |

Chaque fichier est une transaction : la moindre erreur annule la migration entière, sans état partiel. Aucun n'est rejouable — ce sont des `create`, pas des `create if not exists`, pour qu'un second passage échoue au lieu d'écraser silencieusement une base déjà en service. `0002` commence par vérifier que `0001` est présente et qu'elle-même ne l'est pas, et s'arrête sur un message explicite plutôt que sur un « relation already exists ».

Pour vérifier ce qui est déjà en place sur un projet :

```sql
select string_agg(table_name, ', ' order by table_name)
from information_schema.tables where table_schema = 'public';
```

### Deux modes

L'application fonctionne en **démonstration locale par défaut**. Le mode connecté s'active explicitement, pour que la présence de coordonnées Supabase dans l'environnement ne place jamais la démonstration ni les tests derrière un écran de connexion.

```sh
NEXT_PUBLIC_DISPOSP_MODE=connected pnpm build
NEXT_PUBLIC_DISPOSP_MODE=connected pnpm start
```

|                                    | Démonstration  | Connecté                                          |
| ---------------------------------- | -------------- | ------------------------------------------------- |
| Compte requis                      | non            | oui, email et mot de passe                        |
| Données affichées                  | `localStorage` | lues en base, sous RLS                            |
| Saisie                             | enregistrée    | **lecture seule**, l'enregistrement reste à faire |
| Rendu des écrans                   | statique       | dynamique, session lue côté serveur               |
| Sélecteur de rôle de démonstration | visible        | masqué, le rôle vient de la base                  |

En mode connecté, `src/lib/data.server.ts` construit depuis la base exactement la forme que les écrans consomment déjà : aucun écran n'a eu à changer. Le mapping vit à part dans `src/lib/data-mapping.ts`, pur et testé seul, parce que c'est là que se logent les erreurs — fuseau de la fenêtre de réponse, séparation brouillon/publication, révisions périmées, lignes hors de portée RLS.

Une écriture tentée en mode connecté est refusée avec un message. Elle n'est jamais renvoyée en silence vers `localStorage`, ce qui donnerait l'illusion d'un enregistrement.

En mode connecté, un middleware renouvelle la session à chaque requête et renvoie tout visiteur sans session vers `/connexion`. `getUser()` y est utilisé plutôt que `getSession()` : le second se contenterait d'un cookie que le navigateur pourrait forger.

### Premier compte

1. Créer le compte depuis `/connexion` et **confirmer l'adresse** reçue par email.
2. Adapter les quatre valeurs en tête de `supabase/provisioning/premiere-organisation.sql`, puis exécuter le fichier dans l'éditeur SQL du tableau de bord.
3. Adapter le nom du centre et de l'équipe dans `supabase/provisioning/premiere-campagne.sql`, puis l'exécuter : il ouvre la campagne du mois suivant, invite les membres actifs et prépare les créneaux Jour et Nuit du mois. Sans campagne, l'application affiche un écran l'expliquant, puisque tous les écrans en dépendent.

Ces deux scripts sont des gabarits : les tests les exécutent sur PostgreSQL en substituant les valeurs **par nom de variable**, jamais par le texte du gabarit, de sorte qu'ils continuent de passer quelles que soient les valeurs que vous y écrivez.

Ce script est nécessaire parce que le schéma interdit volontairement au client de créer organisations, équipes et rôles. Sans lui, un compte connecté n'est rattaché à rien : l'application affiche alors un écran l'expliquant, plutôt que dix écrans vides. Il refuse un compte inexistant, un compte non confirmé, et un second passage.

La prochaine tranche doit :

1. Porter les huit commandes du domaine en actions serveur, la publication passant par `private.publish_schedule_shift()`.
2. Ajouter au schéma le grade, le matricule et le téléphone d'un agent, exigés au §3 du cahier des charges et absents aujourd'hui : l'annuaire affiche le rôle faute de grade.
3. Ouvrir l'administration des agents, équipes et qualifications aux profils gestionnaire et administrateur.
4. Brancher l'envoi des emails sur la table `notifications` et exposer le journal d'audit dans l'interface.
5. Lier le projet à la CLI Supabase (`supabase link`) et déclarer les migrations déjà appliquées avec `supabase migration repair --status applied`, pour que les suivantes soient gérées par la CLI plutôt que collées dans l'éditeur SQL.

Le schéma actuel est testé avec un vrai moteur PostgreSQL embarqué via PGlite et un schéma Auth simulé. Cela ne remplace pas une vérification de l'intégration Supabase hébergée. Les fonctions `security definer` sont limitées à deux lectures de droits et à la publication d'un créneau, situées dans un schéma privé, avec identité issue de `auth.uid()`. Aucune clé secrète de service n'est nécessaire côté navigateur.

Quelques garanties tenues par la base, et non par l'interface :

- Une révision publiée est écrite par `private.publish_schedule_shift()` seule, qui revérifie l'effectif, les qualifications et l'éligibilité de chaque agent avant de figer la version. Aucune session cliente ne peut écrire une révision publiée ni forcer l'état de publication.
- Le brouillon est la révision 0 ; modifier le brouillon ne touche pas la version que les agents consultent.
- Un agent ne lit que ses propres gardes publiées, jamais le brouillon du responsable.
- Le journal d'audit conserve l'ancienne et la nouvelle valeur, et n'est lisible que par les profils gestionnaire et administrateur.

## Vérification

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Ces six vérifications sont celles exécutées par l'intégration continue.

Les tests de `tests/e2e/connexion.spec.ts` pilotent un vrai projet Supabase : ils se sautent d'eux-mêmes hors du mode connecté, et l'intégration continue, qui n'a pas de coordonnées, les ignore. Pour les exécuter, construire et lancer avec `NEXT_PUBLIC_DISPOSP_MODE=connected`.

Dans un environnement Windows où `pnpm exec` ne résout pas les exécutables, utiliser `node node_modules/@playwright/test/cli.js install chromium`, puis `node node_modules/@playwright/test/cli.js test`.

Pour placer les navigateurs de test dans le projet sous PowerShell :

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
node node_modules/@playwright/test/cli.js install chromium
node node_modules/@playwright/test/cli.js test
```

Les tests couvrent notamment les validations explicites, la clôture, les disponibilités 24 h, les publications, les exports, l'isolation des organisations en PostgreSQL, la publication contrôlée en base, la résistance à une sauvegarde locale inutilisable, la virtualisation de la synthèse et les parcours utilisateur sur ordinateur et mobile. Les tests navigateur fixent l'horloge au 18 septembre 2026 pour rendre la campagne d'exemple reproductible.

## Limites de cette tranche

La V1 du cahier des charges n'est pas encore complète. Le schéma couvre désormais l'ensemble du périmètre, mais **l'interface ne s'y raccorde pas encore** : elle fonctionne toujours sur le stockage local du navigateur.

Restent notamment : authentification réelle, persistance partagée, administration complète des agents/équipes/qualifications, quatre rôles dans l'interface au lieu de deux, fiche agent complète (matricule, email, téléphone, actif/inactif), affectations entre plusieurs équipes, envoi effectif des notifications et des emails, export Excel/PDF, heatmap à trois niveaux, vue par journée avec listes nominatives, ventilation Jour/Nuit du tableau d'équité, disponibilités habituelles enregistrées, PWA installable et tests de charge. Le SSO et les échanges de garde ne sont pas implémentés.

Les brouillons, publications et journaux de la démonstration peuvent être modifiés ou effacés par l'utilisateur du navigateur. Ne pas y saisir de données personnelles réelles.

## Références de mise en œuvre

- [Installation Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [Authentification Supabase côté serveur](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Sécurisation de l'API Supabase](https://supabase.com/docs/guides/api/securing-your-api)
- [Changelog Supabase](https://supabase.com/changelog)
