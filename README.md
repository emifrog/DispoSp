# DispoSP

Application de disponibilités et de planification des sapeurs-pompiers, utilisable en démonstration locale ou en mode connecté à Supabase. Voir [le plan de développement](PLAN_DEVELOPPEMENT.md) pour l’avancement et les étapes restantes.

## Démarrer

Prérequis : Node.js 22 et pnpm. Les versions des dépendances et le fichier de verrouillage sont enregistrés.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir http://127.0.0.1:3000. Pour vérifier une version de production : `pnpm build`, puis `pnpm start`.

L'application démarre avec une **démonstration locale clairement identifiée** : douze agents fictifs et une campagne calculée à partir de la date du jour. Les réponses sont collectées pendant le mois en cours, pour le mois suivant ; une nouvelle démonstration est donc ouverte à la saisie au moment de son initialisation. Les informations sont conservées dans le navigateur, sous `disposp-demo-v1`. Le profil de démonstration est conservé dans la session du navigateur. Aucun compte réel, email, appel métier distant ou paiement n'est créé.

## Parcours livrés

- Connexion, inscription avec confirmation d’adresse et déconnexion ; lecture et écriture des données Supabase selon les droits du compte.
- Tableau de bord distinguant la couverture potentielle (disponibilités validées) de la couverture planifiée (affectations du brouillon). Indicateurs déficit, limite et couvert, plus un état « Besoins non définis ».
- Calendrier agent : cinq états, sélection multiple, saisie par période ou jours de semaine, commentaire, remise à non renseigné.
- Disponibilités habituelles enregistrées par agent et réutilisables dans une campagne. Leur application remplit le calendrier ; elle ne valide pas la réponse et ne crée aucune affectation.
- Validation explicite d’une campagne complète ; invalidation après modification ; verrouillage après clôture.
- Synthèse virtualisée avec colonne agent fixe, tri, recherche, filtres équipe/validation, totaux et vue par journée avec listes nominatives.
- Construction du planning par date et créneau : affectation/retrait, besoins d’effectifs et de qualifications, répartition Jour/Nuit/24 h.
- Publication par créneau avec contrôle de couverture et version indépendante du brouillon ; planning personnel limité aux affectations publiées.
- Campagnes : création, sélection, verrouillage ; paramètres horaires appliqués aux nouvelles campagnes.
- Administration des agents, fiches avec grade/matricule/téléphone, équipes, quatre rôles, qualifications, invitations et désactivation/réactivation.
- Historique filtrable par sujet, auteur et recherche ; centre de notifications avec suivi de lecture et envoi des emails via Resend lorsqu’il est configuré.
- Exports CSV, ICS et Excel ; impression complète de la matrice mensuelle, de la vue par journée et du planning personnel pour enregistrer un PDF.
- Interface adaptée aux ordinateurs et téléphones ; dialogues accessibles au clavier. Le mode démonstration conserve son sélecteur de profil et ses données locales.

## Règles retenues

Voir `DECISIONS_FONCTIONNELLES.md`. Jour 8 h–20 h, Nuit 20 h–8 h le lendemain, nuit rattachée à sa date de début. Une disponibilité 24 h couvre ces deux créneaux sans créer d'affectation. Les horaires sont configurables et appliqués aux nouvelles campagnes ; les créneaux des campagnes existantes sont conservés.

## Architecture

- Next.js App Router, React et TypeScript strict.
- Tailwind CSS, composants Button/Dialog sur les primitives shadcn/Radix, icônes Lucide.
- Registre visuel sobre : le titre d'un écran le nomme et sa ligne de contexte donne un fait — période, effectif, échéance — plutôt qu'une formule. Pas d'étiquette de rubrique, pas d'ombre décorative, un seul rayon d'angle pour les surfaces et les champs, et la couleur réservée au statut.
- Roboto, chargée par `next/font` : la police est téléchargée à la construction et servie depuis l'application, donc aucune requête vers un tiers au chargement d'une page et aucune adresse IP d'agent transmise à Google. Une police de secours aux mêmes métriques évite le saut de texte.
- TanStack Table pour la synthèse, virtualisée par TanStack Virtual : à 300 agents, environ 25 lignes sont rendues au lieu de 300, et les totaux du pied de tableau portent toujours sur l'ensemble des agents filtrés.
- React Hook Form et Zod pour les campagnes et la validation du stockage.
- `src/lib/domain.ts` : règles métier pures, calculs de couverture et commandes testables.
- `src/components/provider.tsx` : stockage local en démonstration, commandes serveur en mode connecté. **Les rôles du navigateur ne constituent pas un contrôle de sécurité.**
- `src/lib/exports.ts` : exports CSV et ICS ; `/api/export` : classeur Excel généré côté serveur en mode connecté.
- `src/app/manifest.ts`, `public/sw.js` et `src/components/pwa.tsx` : installation sur l'écran d'accueil.
- `src/lib/supabase/` : fabriques de clients, middleware de session et détection du mode. Inactives en démonstration.
- `src/lib/session.ts` et `src/lib/session.server.ts` : types partagés d'un côté, lecture de session de l'autre. La séparation est nécessaire — un composant client qui importerait `next/headers` casse la compilation.
- `supabase/migrations/` : 19 tables couvrant organisations, équipes, profils, droits, campagnes, participants, disponibilités, qualifications, créneaux types, besoins d'effectifs et de qualifications, plannings, affectations, invitations, disponibilités habituelles, notifications et audit. Isolation RLS, validation, invalidation et publication contrôlées en base.
- `.github/workflows/ci.yml` : formatage, lint, types, tests unitaires et schéma, build et tests de bout en bout à chaque push et chaque pull request.

## Configuration et fonctionnement Supabase

Le projet de développement dédié est désigné : ses coordonnées sont dans `.env`, qui n'est pas versionné. En mode connecté, l'URL et la clé publiable sont incluses dans le paquet livré au navigateur — c'est le fonctionnement prévu de ces deux valeurs, la clé publiable ne donne accès qu'à ce que les policies RLS autorisent. Aucune clé secrète n'est nécessaire côté client.

### Migrations

Le schéma est découpé en migrations successives, à appliquer dans l'ordre et une seule fois chacune :

| Fichier                                                                | Contenu                                                                                                  | État                                          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `supabase/migrations/0001_foundation.sql`                              | Organisations, équipes, profils, droits, campagnes, participants, disponibilités                         | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0002_planning.sql`                                | Qualifications, créneaux types, besoins, plannings, affectations, notifications, audit                   | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0003_client_writes.sql`                           | Publication joignable depuis le client, horaires du centre, catalogue de qualifications, journal d'audit | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0004_agent_administration.sql`                    | Fiche agent, invitations, administration des équipes et qualifications                                   | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0005_notifications.sql`                           | Notification à l'ouverture d'une campagne                                                                | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0006_email_dispatch.sql`                          | Adresse des agents, file d'envoi, rappel avant clôture                                                   | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0007_availability_templates.sql`                  | Disponibilité habituelle par jour de semaine                                                             | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260918151529_atomic_campaign_creation.sql`      | Création atomique des campagnes, plannings, créneaux et participants                                     | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260918180846_atomic_availability_templates.sql` | Enregistrement et application atomiques de la disponibilité habituelle                                   | Appliquée — confirmation du porteur du projet |

Les deux migrations horodatées, générées par la CLI Supabase, n’ajoutent que des fonctions : `public.create_campaign()` pour la première, `public.save_availability_template()` et `public.apply_availability_template()` pour la seconde. Elles ne modifient aucune donnée existante. Leur application est confirmée par le porteur du projet ; le déploiement de l’application et la vérification du parcours hébergé restent à confirmer.

Chaque fichier est une transaction : la moindre erreur annule la migration entière, sans état partiel. Aucun n'est rejouable — ce sont des `create`, pas des `create if not exists`, pour qu'un second passage échoue au lieu d'écraser silencieusement une base déjà en service. `0002` commence par vérifier que `0001` est présente et qu'elle-même ne l'est pas, et s'arrête sur un message explicite plutôt que sur un « relation already exists ».

Pour vérifier ce qui est déjà en place sur un projet :

```sql
select string_agg(table_name, ', ' order by table_name)
from information_schema.tables where table_schema = 'public';
```

### Exports

Le classeur Excel du §11 est construit par une route serveur, `/api/export`, et non par une action : la réponse est un fichier, et ce choix garde ExcelJS hors de tous les paquets livrés au navigateur — vérifié, la bibliothèque n'apparaît dans aucun morceau client. Six feuilles : disponibilités, synthèse, couverture, affectations, qualifications, statistiques. Le classeur porte sur la campagne sélectionnée et les données accessibles au compte sous RLS. Il ne reprend pas les filtres locaux de la synthèse : l’export CSV, lui, porte sur la vue filtrée.

Le PDF passe par l'impression du navigateur, avec une feuille de style dédiée qui retire la navigation et empêche les coupures au milieu d'une ligne. La matrice mensuelle est virtualisée pour rester utilisable à l'écran, ce qui la rendait inimprimable : **le temps de l'impression, la virtualisation est désactivée** et toutes les lignes sont rendues. `beforeprint` déclenche un rendu synchrone — le navigateur photographie la page dès qu'il reprend la main — et l'écouteur couvre aussi bien le bouton « Imprimer le mois » que le Ctrl+P du navigateur. La page passe alors en A4 paysage, l'en-tête des jours se répète en haut de chaque feuille et les colonnes épinglées redeviennent normales. Trois cents agents font une vingtaine de pages.

### Marque

Le mot-symbole est fourni en deux versions dans `public/` : `logo-disposp.png` (bleu nuit, fonds clairs) et `logo-disposp-blanc.png` (barre latérale). Deux fichiers plutôt qu'un seul recoloré en CSS, parce qu'un filtre sur une image en couleurs donne un gris, pas un blanc. Le composant `Brand` choisit selon le fond et fixe les proportions d'après le fichier, 936 × 214.

Le bleu nuit de la marque est `#092b4e` et son rouge `#de1525`. Le premier est devenu celui de l'interface — barre latérale, variable `--navy`, teinte de la barre d'état — pour que le logo ne se détache pas de son propre fond.

Les icônes d'application portent le symbole — une flamme et un calendrier — en blanc sur le bleu nuit : `icon-192`, `icon-512`, une version `maskable` pour Android, `apple-touch-icon` pour iOS et `src/app/icon.png` pour l'onglet. Le symbole seul est aussi disponible en bleu nuit et en blanc, `symbole-disposp.png` et `symbole-disposp-blanc.png`.

**Ce symbole est une silhouette d'une seule couleur, et c'est une limite connue.** Les deux fichiers reçus du studio étaient des vectorisations automatiques d'une image compressée : le dessin s'y trouvait morcelé en soixante-quatre tracés, avec le bruit de compression transformé en trous à l'intérieur des cases du calendrier. La géométrie a été récupérée par fermeture morphologique — dilatation puis érosion du même rayon, ce qui referme les trous plus petits que le rayon et laisse intactes les gouttières entre les cases. Ce qui n'a pas pu l'être : la répartition bleu nuit / rouge, éparpillée entre les couleurs par le calque, et la coche d'une case, refermée avec le reste. Un vrai fichier vectoriel les rendrait.

### Application installable

`src/app/manifest.ts` décrit l'application, ses icônes et deux raccourcis ; `src/components/pwa.tsx` enregistre l'agent de service et propose l'installation depuis l'écran de profil. Les icônes de `public/` sont engendrées à partir de `src/app/icon.svg` — la même flamme que la marque, sur le bleu nuit de la barre latérale — en trois formes : deux tailles ordinaires et une version « maskable » qui laisse Android découper le contour sans rogner le dessin. iOS ignore le manifeste et prend `apple-touch-icon.png`.

**L'agent de service ne met aucune donnée en cache.** C'est une décision, pas un raccourci : une disponibilité, une affectation ou un planning servis depuis un cache seraient une information périmée présentée comme à jour, ce qui dans ce métier est pire que pas d'information du tout. Il n'existe que parce qu'un navigateur ne propose l'installation qu'à une application dotée d'un gestionnaire `fetch`, et celui-ci laisse tout passer au réseau. Une seule ressource est conservée, `/hors-ligne`, qui ne contient rien et ne peut donc pas dater. La consultation hors ligne reste une extension à cadrer, et les notifications poussées relèvent de la V2.

Sur Chrome et ses dérivés, le profil affiche un bouton lorsque le navigateur signale que l'installation est possible. Safari ne le signale jamais : le chemin iOS — Partager, puis « Sur l'écran d'accueil » — est donc écrit en toutes lettres.

### Notifications et envoi des emails

Une notification est écrite au moment où elle est méritée : un déclencheur l'inscrit à l'ouverture d'une campagne, la fonction de publication à la publication, et `public.remind_campaign()` quand un responsable relance. L'envoi est un acte séparé, qui peut échouer.

`public.notifications` sert donc de file d'attente : `sent_at` appartient à l'expéditeur, `read_at` au destinataire. Après une commande qui en produit, `src/lib/mailer.server.ts` lit la file, envoie le lot à Resend, et marque. **Sans les trois variables `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL`, aucun email n’est envoyé** : les notifications arrivent dans le centre de l'application, et la file attend un prochain passage. C'est la raison d'être de la file — un envoi raté ne doit pas annuler l'écriture qui l'a provoqué.

`RESEND_API_KEY` est le premier secret du projet. Jamais de préfixe `NEXT_PUBLIC_` : il partirait dans le paquet du navigateur. Lire la file suppose de lire les notifications et les adresses d'autrui, ce qu'aucune policy n'autorise et qu'aucune ne devrait ; `public.pending_notifications()` est une fonction définisseure délibérément étroite, qui ne rend rien à qui n'encadre pas le centre.

L'adresse elle-même vient de `auth.users`, que PostgREST n'expose pas. `0006` en garde une copie sur `profiles`, remplie à la création du profil et tenue à jour par déclencheur : l'autorité reste au schéma d'authentification, et aucune session cliente ne peut la modifier.

Le rappel avant clôture est un geste, pas une horloge : personne ne fait tourner de tâche planifiée. Le bouton du tableau de bord vise les agents qui n'ont pas validé, et la base refuse d'empiler deux rappels sur la même personne. L’envoi automatique des invitations n’est pas implémenté : l’administrateur transmet encore l’adresse de l’application à l’agent. Les emails de confirmation d’inscription sont gérés séparément par Supabase Auth.

### Deux modes

L'application fonctionne en **démonstration locale par défaut**. Le mode connecté s'active explicitement, pour que la présence de coordonnées Supabase dans l'environnement ne place jamais la démonstration ni les tests derrière un écran de connexion.

Définir les trois variables suivantes dans `.env` en local et dans la configuration de l’hébergeur pour le site déployé :

```dotenv
NEXT_PUBLIC_DISPOSP_MODE=connected
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=votre-cle-publiable
```

Le mode connecté exige les trois valeurs. Les variables `NEXT_PUBLIC_*` sont intégrées au moment de la construction : après modification, reconstruire puis redémarrer ou redéployer l’application. Pour les emails métier, ajouter côté serveur `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL` ; ne jamais préfixer la clé Resend par `NEXT_PUBLIC_`.

|                                    | Démonstration  | Connecté                            |
| ---------------------------------- | -------------- | ----------------------------------- |
| Compte requis                      | non            | oui, email et mot de passe          |
| Données affichées                  | `localStorage` | lues en base, sous RLS              |
| Saisie                             | enregistrée    | enregistrée en base, sous RLS       |
| Rendu des écrans                   | statique       | dynamique, session lue côté serveur |
| Sélecteur de rôle de démonstration | visible        | masqué, le rôle vient de la base    |

En mode connecté, `src/lib/data.server.ts` construit depuis la base exactement la forme que les écrans consomment déjà : aucun écran n'a eu à changer. Le mapping vit à part dans `src/lib/data-mapping.ts`, pur et testé seul, parce que c'est là que se logent les erreurs — fuseau de la fenêtre de réponse, séparation brouillon/publication, révisions périmées, lignes hors de portée RLS.

Les commandes métier passent par une action serveur unique, `submitCommand`. C'est un point d'entrée public : sa charge utile est parsée par Zod et l'identité vient du cookie de session, jamais de ce que le navigateur annonce. Un refus de la base est traduit en français par `src/lib/command-errors.ts` ; un message inconnu n'est jamais affiché tel quel, puisqu'il décrirait le schéma. Aucune écriture refusée n'est renvoyée en silence vers `localStorage`, ce qui donnerait l'illusion d'un enregistrement.

La création d’une campagne passe désormais par `public.create_campaign()` : campagne, planning, créneaux Jour/Nuit, participants actifs et notifications sont créés dans une transaction unique. Une erreur annule aussi les écritures d’audit. La fonction utilise les droits de l’appelant (`security invoker`) et conserve les contrôles RLS ; les horaires proviennent du centre et la clôture correspond à 23 h 59 min 59 s en Europe/Paris. L’envoi des emails intervient seulement après le succès de la transaction. La migration correspondante est appliquée ; la version de l’application qui appelle cette fonction doit être déployée pour en bénéficier.

En mode connecté, un middleware renouvelle la session à chaque requête et renvoie tout visiteur sans session vers `/connexion`. `getUser()` y est utilisé plutôt que `getSession()` : le second se contenterait d'un cookie que le navigateur pourrait forger.

### Premier compte

1. Créer le compte depuis `/connexion` et **confirmer l'adresse** reçue par email.
2. Adapter les quatre valeurs en tête de `supabase/provisioning/premiere-organisation.sql`, puis exécuter le fichier dans l'éditeur SQL du tableau de bord.
3. Adapter le nom du centre et de l'équipe dans `supabase/provisioning/premiere-campagne.sql`, puis l'exécuter : il ouvre la campagne du mois suivant, invite les membres actifs et prépare les créneaux Jour et Nuit du mois. Sans campagne, l'application affiche un écran l'expliquant, puisque tous les écrans en dépendent.

Ces deux scripts sont des gabarits : les tests les exécutent sur PostgreSQL en substituant les valeurs **par nom de variable**, jamais par le texte du gabarit, de sorte qu'ils continuent de passer quelles que soient les valeurs que vous y écrivez.

Le premier script crée l’organisation et rattache le premier administrateur. Sans ce rattachement, l’application affiche un écran explicatif. Le script refuse un compte inexistant, non confirmé ou déjà rattaché. Une fois ce socle créé, les écrans d’administration permettent de gérer les équipes, les fiches, les rôles et les qualifications selon les droits du compte.

Pour les agents suivants, enregistrer une invitation depuis l’application, transmettre son adresse à l’agent, puis lui faire créer son compte et confirmer son email. Le rattachement repose sur l’adresse invitée. Vérifier ce parcours avec un second compte sur le projet hébergé ; configurer l’adresse publique dans Supabase → Authentication → URL Configuration.

Le schéma est testé avec PostgreSQL embarqué via PGlite et un schéma Auth simulé. Cela ne remplace pas une vérification de l’intégration Supabase hébergée. Les fonctions `security definer` couvrent notamment les lectures de droits, la publication, les déclencheurs d’administration et d’audit, ainsi que les opérations de notifications. Les fonctions exposées pour les rappels et l’envoi des emails contrôlent les droits du compte ; aucune clé de service Supabase n’est nécessaire dans le navigateur.

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

Les tests de `tests/e2e/connexion.spec.ts` ne s’exécutent qu’en mode connecté ; l’intégration continue sans coordonnées Supabase les ignore. Ils vérifient la protection des pages, les erreurs de connexion, la validation du formulaire et la déconnexion sans session. Ils ne constituent pas une recette du parcours complet avec inscription, invitation acceptée et écritures métier sur le projet hébergé.

Pour les lancer, configurer les variables Supabase et `NEXT_PUBLIC_DISPOSP_MODE=connected`, construire l’application, puis exécuter `pnpm test:e2e tests/e2e/connexion.spec.ts`. Pour la suite navigateur de démonstration, revenir à `NEXT_PUBLIC_DISPOSP_MODE=demo` et reconstruire.

Dans un environnement Windows où `pnpm exec` ne résout pas les exécutables, utiliser `node node_modules/@playwright/test/cli.js install chromium`, puis `node node_modules/@playwright/test/cli.js test`.

Pour placer les navigateurs de test dans le projet sous PowerShell :

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
node node_modules/@playwright/test/cli.js install chromium
node node_modules/@playwright/test/cli.js test
```

Les tests couvrent notamment les validations explicites, la clôture, les disponibilités 24 h, les publications, les exports, l'isolation des organisations en PostgreSQL, la publication contrôlée en base, la résistance à une sauvegarde locale inutilisable, la virtualisation de la synthèse et les parcours utilisateur sur ordinateur et mobile. Deux d'entre eux gardent l'adaptation aux écrans : aucune page ne dépasse la largeur de l'appareil à 320 et 768 px, et aucune commande ne descend sous 24 px de côté. Les tests navigateur fixent l'horloge au 18 septembre 2026 pour rendre la campagne d'exemple reproductible.

## Limites et prochaines étapes

Les neuf migrations (`0001` à `0007`, puis les deux migrations horodatées) sont appliquées sur le projet de développement ; l’application lit et écrit les données en mode connecté. Les étapes restantes sont suivies dans [le plan de développement](PLAN_DEVELOPPEMENT.md), et la vérification avant mise en service dans [la recette](RECETTE.md) :

- Confirmer la configuration du site hébergé et effectuer une recette avec plusieurs comptes : invitation, confirmation d’adresse, disponibilités habituelles, validation, publication et réception des emails.
- Déployer la version qui appelle `public.create_campaign()`, `public.save_availability_template()` et `public.apply_availability_template()`, puis vérifier ces parcours en mode connecté : les migrations sont appliquées, le comportement hébergé reste à observer.
- Finaliser la mise en service : configuration de l’expéditeur, suivi des échecs d’envoi, sauvegardes/restauration et règles de conservation des données.

L’envoi Resend traite des lots de 50 notifications après certaines commandes. Il n’existe ni rappel planifié ni traitement autonome de toute la file en attente. L’envoi automatique des invitations reste à développer. Le SSO et les échanges de garde ne sont pas implémentés.

Les brouillons, publications et journaux de la démonstration peuvent être modifiés ou effacés par l’utilisateur du navigateur. Ne pas y saisir de données personnelles réelles.

## Références de mise en œuvre

- [Installation Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [Authentification Supabase côté serveur](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Sécurisation de l'API Supabase](https://supabase.com/docs/guides/api/securing-your-api)
- [Changelog Supabase](https://supabase.com/changelog)
