# DispoSP

Application de disponibilités et de planification des sapeurs-pompiers, branchée sur Supabase. Voir [le plan de développement](PLAN_DEVELOPPEMENT.md) pour l’avancement et les étapes restantes.

## Démarrer

Prérequis : Node.js 22 et pnpm. Les versions des dépendances et le fichier de verrouillage sont enregistrés.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir http://127.0.0.1:3000. Pour vérifier une version de production : `pnpm build`, puis `pnpm start`.

L'application demande un compte. Sans session, toute adresse renvoie vers l'écran de connexion — hormis ce qu'un navigateur va chercher avant d'en avoir une : le manifeste, l'agent de service et la page hors ligne. Rien n'est conservé dans le navigateur : l'état vient du rendu serveur, relu à chaque navigation.

## Parcours livrés

- Connexion par mot de passe, réinitialisation en cas d’oubli, authentification unique SAML par domaine et déconnexion ; lecture et écriture des données Supabase selon les droits du compte.
- Arrivée d’un agent : le gestionnaire renseigne la fiche et envoie l’invitation, l’agent reçoit un message d’activation, choisit son mot de passe et rejoint son centre avec le rôle prévu. **Personne ne choisit ni ne transmet le mot de passe d’un agent.** L’invitation en attente se renvoie ou s’annule.
- Accueil agent : campagne en cours, avancement de la saisie, prochaines gardes publiées et accès rapides. La racine aiguille selon le rôle — accueil pour un agent, tableau de bord pour qui encadre.
- Tableau de bord distinguant la couverture potentielle (disponibilités validées) de la couverture planifiée (affectations du brouillon). Indicateurs déficit, limite et couvert, plus un état « Besoins non définis ».
- Calendrier agent : cinq états, sélection multiple, saisie par période ou jours de semaine, commentaire, remise à non renseigné.
- Disponibilités habituelles enregistrées par agent et réutilisables dans une campagne. Leur application remplit le calendrier ; elle ne valide pas la réponse et ne crée aucune affectation.
- Validation explicite d’une campagne complète ; invalidation après modification ; verrouillage après clôture.
- Synthèse virtualisée avec colonne agent fixe, tri, recherche, filtres équipe/validation, totaux et vue par journée avec listes nominatives.
- Construction du planning par date et créneau : affectation/retrait, besoins d’effectifs et de qualifications, répartition Jour/Nuit/24 h.
- Publication par créneau avec contrôle de couverture et version indépendante du brouillon ; planning personnel limité aux affectations publiées.
- Campagnes : création, sélection, verrouillage ; paramètres horaires appliqués aux nouvelles campagnes.
- Besoins du mois sur un écran : effectifs et minima par qualification, journée par journée, avec application en lot à une sélection de jours de semaine.
- Statistiques sous trois angles : mois par mois sur l’ensemble des campagnes, par jour de semaine pour repérer les trous réguliers, et par agent.
- Désistements : un agent signale qu’il ne peut plus tenir une garde publiée, l’encadrement tranche. Accepter ne réaffecte pas — le remplacement se fait au planning, et l’écran le rappelle tant qu’il n’est pas fait.
- Administration des agents, fiches avec grade, fonction, matricule et téléphone, équipes, trois rôles, qualifications, invitations et désactivation/réactivation.
- Historique filtrable par sujet, auteur et recherche ; centre de notifications avec suivi de lecture et envoi des emails via Resend lorsqu’il est configuré.
- Exports CSV, ICS et Excel ; impression complète de la matrice mensuelle, de la vue par journée et du planning personnel pour enregistrer un PDF.
- Interface adaptée aux ordinateurs et téléphones, de 320 px au grand écran ; dialogues accessibles au clavier.

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
- `src/components/provider.tsx` : l'état vient du rendu serveur, relu à chaque navigation ; les commandes partent à l'action serveur. Rien n'est conservé dans le navigateur. **Les rôles affichés ne constituent pas un contrôle de sécurité** : la base décide.
- `src/lib/exports.ts` : exports CSV et ICS ; `/api/export` : classeur Excel généré côté serveur en mode connecté.
- `src/app/manifest.ts`, `public/sw.js` et `src/components/pwa.tsx` : installation sur l'écran d'accueil.
- `src/lib/supabase/` : fabriques de clients et middleware de session. `publicPaths` liste ce que le garde ne doit jamais intercepter — déconnexion, choix d'un nouveau mot de passe et vérification du lien qui y mène, manifeste, agent de service, page hors ligne. Les deux écrans de mot de passe en font partie parce qu'on y arrive précisément sans session. **L'ordre compte** : le garde regarde le chemin avant d'exiger la configuration Supabase, sinon un environnement qui n'en a pas — l'intégration continue — échouerait jusqu'à servir le manifeste. La moitié inverse de la décision tient toujours : un écran de travail sans configuration s'arrête au lieu de s'afficher vide. `tests/middleware.test.ts` garde les deux.
- `src/lib/session.ts` et `src/lib/session.server.ts` : types partagés d'un côté, lecture de session de l'autre. La séparation est nécessaire — un composant client qui importerait `next/headers` casse la compilation.
- `supabase/migrations/` : 20 tables couvrant organisations, équipes, profils, droits, campagnes, participants, disponibilités, qualifications, créneaux types, besoins d'effectifs et de qualifications, plannings, affectations, désistements, invitations, disponibilités habituelles, notifications et audit. Isolation RLS, validation, invalidation et publication contrôlées en base.
- `.github/workflows/ci.yml` : formatage, lint, types, tests unitaires et schéma, build et tests de bout en bout à chaque push et chaque pull request.

## Configuration et fonctionnement Supabase

Le projet de développement dédié est désigné : ses coordonnées sont dans `.env`, qui n'est pas versionné. En mode connecté, l'URL et la clé publiable sont incluses dans le paquet livré au navigateur — c'est le fonctionnement prévu de ces deux valeurs, la clé publiable ne donne accès qu'à ce que les policies RLS autorisent. **Aucune clé secrète ne descend dans le navigateur.**

### La clé secrète, et pourquoi elle existe

Le projet en a désormais une, `SUPABASE_SECRET_KEY`, et une seule raison de l'avoir : **créer le compte d'un agent invité**. C'est une opération d'administration, que la clé publiable ne peut pas faire par construction. Sans elle, il faudrait soit ouvrir l'inscription à tout venant, soit qu'un tiers choisisse le mot de passe d'un agent — les deux ont été écartés.

Cette clé passe outre toutes les policies RLS. Trois précautions la cantonnent, et elles se tiennent ensemble :

- Elle ne vit que dans [`admin.server.ts`](src/lib/supabase/admin.server.ts), marqué `server-only` : le module refuse de se compiler dans un paquet navigateur.
- Pas de préfixe `NEXT_PUBLIC_`, sans quoi elle partirait dans ce paquet.
- Le client qu'elle ouvre ne sert **qu'à** `auth.admin.inviteUserByEmail`. Il ne lit ni n'écrit aucune table. Une seule lecture faite avec lui contournerait le cloisonnement entre centres sans que rien ne le signale.

Elle est facultative. Sans elle, l'invitation enregistre toujours qui est attendu ; l'agent ne reçoit simplement pas son message, et le gestionnaire le lit à l'écran plutôt que de le découvrir plus tard.

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

| `supabase/migrations/20260919120000_grades_fonctions_roles.sql` | Trois rôles au lieu de quatre, séparation du grade et de la fonction | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260919200000_desistements.sql` | Désistements sur une garde publiée, leurs notifications et leur audit | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260920090000_correctifs_droits_et_besoins.sql` | Ferme l'escalade par invitation ; rend l'écriture d'un besoin atomique | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260920140000_invitation_compte_existant.sql` | Rattache un invité dont le compte existe déjà | **À appliquer** |

Les deux migrations du 18 septembre n’ajoutent que des fonctions : `public.create_campaign()` pour la première, `public.save_availability_template()` et `public.apply_availability_template()` pour la seconde. Elles ne modifient aucune donnée existante.

Celles du 19 septembre vont plus loin. `20260919120000` **modifie des données** : `RESPONSABLE` disparaît et les comptes qui le portaient passent `GESTIONNAIRE`. C’est une extension de droits — d’une seule équipe au centre entier, plus le droit d’inviter — tracée au journal d’audit. Elle ajoute `profiles.fonction` et `invitations.fonction`, et `private.can_manage()` perd sa branche par équipe : un gestionnaire gère désormais tout son centre, et le filtre par équipe n’a plus d’objet.

`20260919200000` ajoute `public.shift_withdrawals`. Un agent ne peut s’y inscrire que pour lui-même et que sur une garde qu’il tient réellement : `private.holds_published_shift()` exige de figurer dans la révision publiée. Le décideur est estampillé par un déclencheur, jamais par le client, et la table ne touche pas au planning.

Le déploiement de l’application et la vérification du parcours hébergé restent à confirmer.

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

Le mot-symbole est fourni en deux versions dans `public/`, parce qu'une image ne se recolore pas : un filtre CSS sur un dessin en couleurs donne un gris, jamais un blanc. `logo-disposp.png` (1521 × 486, fond transparent) porte le bleu nuit et va sur les fonds clairs — connexion, fiche de compte, en-tête d'impression. `logo-disposp-sombre.png` (1800 × 850) arrive du studio posé sur sa propre plaque bleu nuit et va sur la barre latérale. Le composant `Brand` choisit par la surface plutôt que par la couleur — `onLight`, `onDark` — et tient les proportions de chaque fichier séparément, les deux n'ayant pas le même rapport.

La plaque du fichier sombre n'est pas détourée : c'est un rectangle plein. Elle passe inaperçue parce que la barre latérale porte **exactement** sa teinte. C'est la contrainte à retenir si la couleur de la barre change un jour — le rectangle réapparaîtrait aussitôt.

Le bleu nuit de la marque est `#08284a` et son rouge `#df1427`, relevés dans le fichier lui-même. Le premier est celui de l'interface — barre latérale, variable `--navy`, teinte de la barre d'état, `theme_color` du manifeste — pour que le logo ne se détache pas de son propre fond. Le `--red` de l'interface, lui, reste distinct : il sert aux erreurs, pas à la marque.

Les icônes d'application portent le symbole, une flamme et un calendrier en couleurs sur fond blanc : `icon-192` et `icon-512` tels que livrés, `apple-touch-icon` en 180 aplati sur du blanc — iOS rend opaque toute transparence, et une icône transparente y virerait au noir — et `src/app/icon.png` en 64 pour l'onglet. La version `maskable` d'Android est composée à part, le symbole ramené à 72 % de la toile : le système recadre l'icône jusqu'au cercle inscrit, et à pleine taille il couperait la flamme. Le symbole seul, fond transparent, est disponible en `symbole-disposp.png` ; il sert la barre du haut sur mobile.

Les fichiers d'origine restent dans `public/logo v2/`, sous leurs noms de livraison. Les fichiers servis en sont des copies renommées par usage : l'espace dans le nom du dossier n'a pas à se retrouver dans une URL, et « v2 » aura tort à la prochaine version.

### Application installable

`src/app/manifest.ts` décrit l'application, ses icônes et deux raccourcis ; `src/components/pwa.tsx` enregistre l'agent de service et propose l'installation depuis l'écran de profil. Les icônes servies viennent du dossier de marque, comme décrit plus haut ; iOS ignore le manifeste et prend `apple-touch-icon.png`.

**L'agent de service ne met aucune donnée en cache.** C'est une décision, pas un raccourci : une disponibilité, une affectation ou un planning servis depuis un cache seraient une information périmée présentée comme à jour, ce qui dans ce métier est pire que pas d'information du tout. Il n'existe que parce qu'un navigateur ne propose l'installation qu'à une application dotée d'un gestionnaire `fetch`, et celui-ci laisse tout passer au réseau. Une seule ressource est conservée, `/hors-ligne`, qui ne contient rien et ne peut donc pas dater. La consultation hors ligne reste une extension à cadrer, et les notifications poussées relèvent de la V2.

Sur Chrome et ses dérivés, le profil affiche un bouton lorsque le navigateur signale que l'installation est possible. Safari ne le signale jamais : le chemin iOS — Partager, puis « Sur l'écran d'accueil » — est donc écrit en toutes lettres.

### Notifications et envoi des emails

Une notification est écrite au moment où elle est méritée : un déclencheur l'inscrit à l'ouverture d'une campagne, la fonction de publication à la publication, et `public.remind_campaign()` quand un responsable relance. L'envoi est un acte séparé, qui peut échouer.

`public.notifications` sert donc de file d'attente : `sent_at` appartient à l'expéditeur, `read_at` au destinataire. Après une commande qui en produit, `src/lib/mailer.server.ts` lit la file, envoie le lot à Resend, et marque. **Sans les trois variables `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL`, aucun email n’est envoyé** : les notifications arrivent dans le centre de l'application, et la file attend un prochain passage. C'est la raison d'être de la file — un envoi raté ne doit pas annuler l'écriture qui l'a provoqué.

`RESEND_API_KEY` est le premier secret du projet. Jamais de préfixe `NEXT_PUBLIC_` : il partirait dans le paquet du navigateur. Lire la file suppose de lire les notifications et les adresses d'autrui, ce qu'aucune policy n'autorise et qu'aucune ne devrait ; `public.pending_notifications()` est une fonction définisseure délibérément étroite, qui ne rend rien à qui n'encadre pas le centre.

L'adresse elle-même vient de `auth.users`, que PostgREST n'expose pas. `0006` en garde une copie sur `profiles`, remplie à la création du profil et tenue à jour par déclencheur : l'autorité reste au schéma d'authentification, et aucune session cliente ne peut la modifier.

Le rappel avant clôture est un geste, pas une horloge : personne ne fait tourner de tâche planifiée. Le bouton du tableau de bord vise les agents qui n'ont pas validé, et la base refuse d'empiler deux rappels sur la même personne. L’envoi automatique des invitations n’est pas implémenté : l’administrateur transmet encore l’adresse de l’application à l’agent. Les emails de confirmation d’inscription sont gérés séparément par Supabase Auth.

### Configuration

Définir les deux variables suivantes dans `.env` en local et dans la configuration de l’hébergeur pour le site déployé :

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=votre-cle-publiable
```

**Il n'existe pas de mode de repli.** Sans ces valeurs l'application s'arrête, et c'est délibéré : un déploiement mal configuré doit se voir. Le mode démonstration, qui affichait douze agents fictifs conservés dans le navigateur, a été retiré — un site en production ne peut donc plus montrer silencieusement de fausses données à la place des vraies.

Les variables `NEXT_PUBLIC_*` sont intégrées au moment de la construction : après modification, reconstruire puis redémarrer ou redéployer l’application. Pour les emails métier, ajouter côté serveur `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL` ; ne jamais préfixer la clé Resend par `NEXT_PUBLIC_`.

`src/lib/data.server.ts` construit depuis la base exactement la forme que les écrans consomment déjà : aucun écran n'a eu à changer. Le mapping vit à part dans `src/lib/data-mapping.ts`, pur et testé seul, parce que c'est là que se logent les erreurs — fuseau de la fenêtre de réponse, séparation brouillon/publication, révisions périmées, lignes hors de portée RLS.

Les commandes métier passent par une action serveur unique, `submitCommand`. C'est un point d'entrée public : sa charge utile est parsée par Zod et l'identité vient du cookie de session, jamais de ce que le navigateur annonce. Un refus de la base est traduit en français par `src/lib/command-errors.ts` ; un message inconnu n'est jamais affiché tel quel, puisqu'il décrirait le schéma. Aucune écriture refusée n'est renvoyée en silence vers `localStorage`, ce qui donnerait l'illusion d'un enregistrement.

La création d’une campagne passe désormais par `public.create_campaign()` : campagne, planning, créneaux Jour/Nuit, participants actifs et notifications sont créés dans une transaction unique. Une erreur annule aussi les écritures d’audit. La fonction utilise les droits de l’appelant (`security invoker`) et conserve les contrôles RLS ; les horaires proviennent du centre et la clôture correspond à 23 h 59 min 59 s en Europe/Paris. L’envoi des emails intervient seulement après le succès de la transaction. La migration correspondante est appliquée ; la version de l’application qui appelle cette fonction doit être déployée pour en bénéficier.

En mode connecté, un middleware renouvelle la session à chaque requête et renvoie tout visiteur sans session vers `/connexion`. `getUser()` y est utilisé plutôt que `getSession()` : le second se contenterait d'un cookie que le navigateur pourrait forger.

### Premier compte

1. Créer le compte depuis `/connexion` et **confirmer l'adresse** reçue par email.
2. Adapter les quatre valeurs en tête de `supabase/provisioning/premiere-organisation.sql`, puis exécuter le fichier dans l'éditeur SQL du tableau de bord.
3. Adapter le nom du centre et de l'équipe dans `supabase/provisioning/premiere-campagne.sql`, puis l'exécuter : il ouvre la campagne du mois suivant, invite les membres actifs et prépare les créneaux Jour et Nuit du mois. Sans campagne, l'application affiche un écran l'expliquant, puisque tous les écrans en dépendent.

Ces deux scripts sont des gabarits : les tests les exécutent sur PostgreSQL en substituant les valeurs **par nom de variable**, jamais par le texte du gabarit, de sorte qu'ils continuent de passer quelles que soient les valeurs que vous y écrivez.

Le premier script crée l’organisation et rattache le premier administrateur. Sans ce rattachement, l’application affiche un écran explicatif. Le script refuse un compte inexistant, non confirmé ou déjà rattaché. Une fois ce socle créé, les écrans d’administration permettent de gérer les équipes, les fiches, les rôles et les qualifications selon les droits du compte.

Pour les agents suivants, envoyer une invitation depuis l’application : l’agent reçoit un message d’activation, choisit son mot de passe et rejoint le centre avec le rôle prévu. Le rattachement repose sur l’adresse invitée et se fait en base, jamais depuis le navigateur.

Deux chemins, et la base les tient tous les deux. Un compte neuf est rattaché à la confirmation de son adresse. Un compte **qui existe déjà** — agent retiré puis réinvité, ou venu d’un autre centre — est rattaché à l’enregistrement même de l’invitation : il ne repassera jamais par une confirmation, et son invitation serait autrement restée en attente pour toujours. Dans ce cas aucun message ne part, et l’écran le dit.

Configurer l’adresse publique dans Supabase → Authentication → URL Configuration, et les deux gabarits d’e-mail ci-dessus.

Le schéma est testé avec PostgreSQL embarqué via PGlite et un schéma Auth simulé. Cela ne remplace pas une vérification de l’intégration Supabase hébergée. Les fonctions `security definer` couvrent notamment les lectures de droits, la publication, les déclencheurs d’administration et d’audit, ainsi que les opérations de notifications. Les fonctions exposées pour les rappels et l’envoi des emails contrôlent les droits du compte ; aucune clé de service Supabase n’est nécessaire dans le navigateur.

Quelques garanties tenues par la base, et non par l'interface :

- Une révision publiée est écrite par `private.publish_schedule_shift()` seule, qui revérifie l'effectif, les qualifications et l'éligibilité de chaque agent avant de figer la version. Aucune session cliente ne peut écrire une révision publiée ni forcer l'état de publication.
- Le brouillon est la révision 0 ; modifier le brouillon ne touche pas la version que les agents consultent.
- Un agent ne lit que ses propres gardes publiées, jamais le brouillon du gestionnaire.

- Depuis la migration `20260920090000_correctifs_droits_et_besoins.sql`, un gestionnaire peut inviter un agent ou un gestionnaire ; seul un administrateur peut accorder ADMIN. La règle est contrôlée en base à la création et à la modification d’une invitation en attente. Vérifier que cette migration est appliquée avant de déployer le code correspondant.
- `public.set_staffing_requirement()` écrit l’effectif et les minima d’un créneau dans une transaction : un refus conserve le besoin précédent. L’application d’un besoin à plusieurs créneaux reste partielle si un appel échoue.

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

**La suite navigateur a fondu avec le mode démonstration**, et il faut le dire franchement : les trente parcours d'interface qu'elle jouait — saisie, validation, affectation, publication, exports — pilotaient douze agents fictifs qui n'existent plus. Ils n'ont pas été remplacés par des tests automatiques ; ils sont devenus les étapes manuelles de [la recette](RECETTE.md). Ce qui reste automatique et sans données : le manifeste, les icônes, l'agent de service et l'adaptation aux écrans.

Les parcours de `tests/e2e/connexion.spec.ts` demandent un projet Supabase joignable et se sautent sans `NEXT_PUBLIC_SUPABASE_URL` — ce qui est le cas de l'intégration continue, qui n'en fournit aucun et vérifie ainsi que la surface publique se sert sans base.

En local, rien à exporter : la configuration Playwright charge `.env` comme Next le fait pour le serveur. Sans cela les deux divergeaient, et des parcours se sautaient en croyant le serveur non configuré alors qu'il l'était — « douze tests ignorés » qui ne voulaient plus rien dire.

Les deux parcours de `pwa.spec.ts` qui demandent une session attendent `E2E_EMAIL` et `E2E_PASSWORD`, un compte d'essai rattaché à un centre. Sans eux ils se sautent, au lieu d'échouer sur un écran de connexion.

Les règles métier, elles, n'ont rien perdu : elles sont vérifiées contre un vrai PostgreSQL par les 95 tests de `tests/database.test.ts`, migrations et politiques comprises — 145 tests au total au commit `2abab2e`. Le suivi des vérifications et des correctifs figure dans [le rapport d’analyse](ANALYSE_PROJET_2026-09-19.md).

Dans un environnement Windows où `pnpm exec` ne résout pas les exécutables, utiliser `node node_modules/@playwright/test/cli.js install chromium`, puis `node node_modules/@playwright/test/cli.js test`.

Pour placer les navigateurs de test dans le projet sous PowerShell :

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
node node_modules/@playwright/test/cli.js install chromium
node node_modules/@playwright/test/cli.js test
```

Les tests couvrent notamment les validations explicites, la clôture, les disponibilités 24 h, les publications, les exports, l'isolation des organisations en PostgreSQL, la publication contrôlée en base, la résistance à une sauvegarde locale inutilisable, la virtualisation de la synthèse et les parcours utilisateur sur ordinateur et mobile. Deux d'entre eux gardent l'adaptation aux écrans : aucune page ne dépasse la largeur de l'appareil à 320 et 768 px, et aucune commande ne descend sous 24 px de côté. Les tests navigateur fixent l'horloge au 18 septembre 2026 pour rendre la campagne d'exemple reproductible.

## Limites et prochaines étapes

Les onze migrations (`0001` à `0007`, puis les quatre migrations horodatées) sont appliquées sur le projet de développement ; l’application lit et écrit les données en mode connecté. Les étapes restantes sont suivies dans [le plan de développement](PLAN_DEVELOPPEMENT.md), et la vérification avant mise en service dans [la recette](RECETTE.md) :

- Confirmer la configuration du site hébergé et effectuer une recette avec plusieurs comptes : invitation, confirmation d’adresse, disponibilités habituelles, validation, publication et réception des emails.
- Déployer la version qui appelle `public.create_campaign()`, `public.save_availability_template()` et `public.apply_availability_template()`, puis vérifier ces parcours en mode connecté : les migrations sont appliquées, le comportement hébergé reste à observer.
- Finaliser la mise en service : configuration de l’expéditeur, suivi des échecs d’envoi, sauvegardes/restauration et règles de conservation des données.

L’envoi Resend traite des lots de 50 notifications après certaines commandes. Il n’existe ni rappel planifié ni traitement autonome de toute la file en attente.

**Les messages d’activation et de réinitialisation ne passent pas par Resend** : ils sont envoyés par Supabase Auth, avec son propre expéditeur. Deux gabarits sont à régler dans Authentication → Email Templates, faute de quoi les liens ne fonctionnent que sur l’appareil qui a fait la demande — or ce n’est jamais le cas pour une activation, demandée par le gestionnaire et ouverte par l’agent :

| Gabarit          | Lien à mettre                                                                |
| ---------------- | ---------------------------------------------------------------------------- |
| `Invite user`    | `{{ .SiteURL }}/auth/activation?token_hash={{ .TokenHash }}&type=invite`     |
| `Reset password` | `{{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&type=recovery` |

**L’authentification unique est écrite mais pas joignable.** `signInWithSSO()` route sur le domaine de l’adresse saisie ; tant qu’aucun fournisseur SAML n’est déclaré côté Supabase — ce qui suppose un plan payant et la CLI — l’écran affiche l’explication et renvoie au mot de passe.

**La réinitialisation du mot de passe fonctionne sur les deux chemins**, mais l’un demande un réglage. Le gabarit d’e-mail par défaut renvoie un code lié au navigateur qui a fait la demande : ouvrir le message sur un autre appareil échoue. Pour couvrir ce cas, régler le gabarit « Reset password » de Supabase sur `{{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&type=recovery`, ce que la route serveur du même nom sait vérifier quel que soit l’appareil.

Les désistements sont implémentés ; les **échanges nommés** entre agents — « je te donne ma garde, tu prends la mienne » — ne le sont pas : un agent signale qu’il ne peut plus tenir une garde, l’encadrement réaffecte.

Le retrait d'un compte et de ses données se fait par `supabase/provisioning/retirer-un-compte.sql`, dans l'éditeur SQL du tableau de bord. Il efface dans l'ordre des dépendances, refuse de laisser un centre sans administrateur actif, et ne touche pas au journal d'audit : c'est la suppression du compte lui-même, à la main, qui en anonymise l'auteur.

## Références de mise en œuvre

- [Installation Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [Authentification Supabase côté serveur](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Sécurisation de l'API Supabase](https://supabase.com/docs/guides/api/securing-your-api)
- [Changelog Supabase](https://supabase.com/changelog)
