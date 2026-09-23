# DispoSP

Application de disponibilités et de planification des sapeurs-pompiers, branchée sur Supabase. Voir [le plan de développement](PLAN_DEVELOPPEMENT.md) pour l’avancement et les étapes restantes.

## Démarrer

Prérequis : Node.js 22 et pnpm. Les versions des dépendances et le fichier de verrouillage sont enregistrés.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir http://127.0.0.1:3000. Pour vérifier une version de production : `pnpm build`, puis `pnpm start`.

**Les notifications poussées demandent une version de production.** En développement, l'agent de service n'est pas enregistré au chargement — il survivrait aux rechargements et brouillerait la lecture de ce qui vient du serveur ; le bouton d'activation l'enregistre alors à la demande. `127.0.0.1` est traité comme une origine sûre, donc l'essai fonctionne en local.

L'application demande un compte. Sans session, toute adresse renvoie vers l'écran de connexion — hormis ce qu'un navigateur va chercher avant d'en avoir une : le manifeste, l'agent de service et la page hors ligne. Aucune donnée métier n'est conservée dans le navigateur : l'état vient du rendu serveur, relu à chaque navigation. Une seule chose y reste, et elle ne parle pas du centre : la réponse donnée à l'invitation d'activer les notifications sur cet appareil.

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
- Notifications poussées sur le téléphone, application fermée, une fois activées depuis le profil sur l’appareil concerné.
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
- `src/components/provider.tsx` : l'état vient du rendu serveur, relu à chaque navigation, après chaque écriture, et quand l'application revient au premier plan après plus de trente secondes d'absence ou que le réseau revient — une application installée reste ouverte des jours sur un téléphone ; les commandes partent à l'action serveur. Aucune donnée métier n'est conservée dans le navigateur — la seule exception est la réponse à l'invitation d'activer les notifications, qui porte sur l'appareil et non sur le centre. **Les rôles affichés ne constituent pas un contrôle de sécurité** : la base décide.
- `src/lib/exports.ts` : exports CSV et ICS ; `/api/export` : classeur Excel généré côté serveur en mode connecté.
- `src/app/manifest.ts`, `public/sw.js` et `src/components/pwa.tsx` : installation sur l'écran d'accueil et activation des notifications poussées, appareil par appareil.
- `src/lib/push.ts`, `src/lib/push.server.ts` et `src/app/api/push/` : contenu poussé, file d'envoi signée en VAPID, inscription d'un appareil et envoi d'essai.
- `src/lib/supabase/` : fabriques de clients et middleware de session. `publicPaths` liste ce que le garde ne doit jamais intercepter — déconnexion, choix d'un nouveau mot de passe et vérification du lien qui y mène, manifeste, agent de service, page hors ligne. Les deux écrans de mot de passe en font partie parce qu'on y arrive précisément sans session. **L'ordre compte** : le garde regarde le chemin avant d'exiger la configuration Supabase, sinon un environnement qui n'en a pas — l'intégration continue — échouerait jusqu'à servir le manifeste. La moitié inverse de la décision tient toujours : un écran de travail sans configuration s'arrête au lieu de s'afficher vide. `tests/middleware.test.ts` garde les deux.
- `src/lib/session.ts` et `src/lib/session.server.ts` : types partagés d'un côté, lecture de session de l'autre. La séparation est nécessaire — un composant client qui importerait `next/headers` casse la compilation.
- `supabase/migrations/` : 22 tables couvrant organisations, équipes, profils, droits, campagnes, participants, disponibilités, qualifications, créneaux types, besoins d'effectifs et de qualifications, plannings, affectations, désistements, invitations, disponibilités habituelles, notifications, abonnements des appareils, file des envois poussés et audit. Isolation RLS, validation, invalidation et publication contrôlées en base.
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

| Fichier                                                                           | Contenu                                                                                                                                                                                                           | État                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `supabase/migrations/0001_foundation.sql`                                         | Organisations, équipes, profils, droits, campagnes, participants, disponibilités                                                                                                                                  | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0002_planning.sql`                                           | Qualifications, créneaux types, besoins, plannings, affectations, notifications, audit                                                                                                                            | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0003_client_writes.sql`                                      | Publication joignable depuis le client, horaires du centre, catalogue de qualifications, journal d'audit                                                                                                          | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0004_agent_administration.sql`                               | Fiche agent, invitations, administration des équipes et qualifications                                                                                                                                            | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0005_notifications.sql`                                      | Notification à l'ouverture d'une campagne                                                                                                                                                                         | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0006_email_dispatch.sql`                                     | Adresse des agents, file d'envoi, rappel avant clôture                                                                                                                                                            | Appliquée le 18 septembre 2026                |
| `supabase/migrations/0007_availability_templates.sql`                             | Disponibilité habituelle par jour de semaine                                                                                                                                                                      | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260918151529_atomic_campaign_creation.sql`                 | Création atomique des campagnes, plannings, créneaux et participants                                                                                                                                              | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260918180846_atomic_availability_templates.sql`            | Enregistrement et application atomiques de la disponibilité habituelle                                                                                                                                            | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260919120000_grades_fonctions_roles.sql`                   | Trois rôles au lieu de quatre, séparation du grade et de la fonction                                                                                                                                              | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260919200000_desistements.sql`                             | Désistements sur une garde publiée, leurs notifications et leur audit                                                                                                                                             | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260920090000_correctifs_droits_et_besoins.sql`             | Ferme l'escalade par invitation ; rend l'écriture d'un besoin atomique                                                                                                                                            | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260920140000_invitation_compte_existant.sql`               | Rattache un invité dont le compte existe déjà                                                                                                                                                                     | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260921090000_eligibilite_publication.sql`                  | Contrôle d'éligibilité à la publication d'une garde                                                                                                                                                               | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260921100156_web_push_notifications.sql`                   | Abonnements des appareils, file des envois poussés et son traitement                                                                                                                                              | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260921130000_web_push_abonnement.sql`                      | Inscription d'un appareil par la session qui le tient                                                                                                                                                             | Appliquée — confirmation du porteur du projet |
| `supabase/migrations/20260921140000_verrou_publication.sql`                       | Verrou de ligne sur le créneau publié, contre deux publications simultanées                                                                                                                                       | Appliquée le 22 septembre 2026                |
| `supabase/migrations/20260922100000_reactivation_administrateur_devalidation.sql` | Fiche des membres désactivés ouverte à l'encadrement ; dernier administrateur protégé ; dévalidation sous la même fenêtre que la validation, journalisée                                                          | Appliquée le 22 septembre 2026                |
| `supabase/migrations/20260922150000_rattachement_retrait_file_email.sql`          | Un seul centre actif par compte, invitation d'un compte actif ailleurs refusée, membre désactivé réinvité réactivé ; retrait d'un compte possible (invitations) ; file d'emails avec bail, tentatives et état     | Appliquée le 22 septembre 2026                |
| `supabase/migrations/20260923090000_fiche_agent_atomique.sql`                     | `public.save_member()` : rattachement, profil et qualifications d'un agent écrits en une seule transaction                                                                                                        | Appliquée le 23 septembre 2026                |
| `supabase/migrations/20260923140000_limites_envois.sql`                           | Limites d'envoi : un rappel par campagne toutes les 12 h ; invitations espacées d'un quart d'heure, cinq envois au plus, cinquante par heure et par centre                                                        | **À appliquer avant de déployer le code**     |
| `supabase/migrations/20260923180000_rendre_envoi_invitation.sql`                  | Un envoi d'invitation qui n'est pas parti est rendu (`release_invitation_send`, réservée au serveur) : il ne compte plus dans les limites                                                                         | **À appliquer avant de déployer le code**     |
| `supabase/migrations/20260923200000_relances_et_plafonds.sql`                     | Relances : campagne ouverte, membres actifs, sans dépendre de l'envoi du précédent. Invitations limitées par adresse, même effacées. Désistement refait sans renotifier. Dix emails par heure et par destinataire | **À appliquer avant de déployer le code**     |

Les deux migrations du 18 septembre n’ajoutent que des fonctions : `public.create_campaign()` pour la première, `public.save_availability_template()` et `public.apply_availability_template()` pour la seconde. Elles ne modifient aucune donnée existante.

Celles du 19 septembre vont plus loin. `20260919120000` **modifie des données** : `RESPONSABLE` disparaît et les comptes qui le portaient passent `GESTIONNAIRE`. C’est une extension de droits — d’une seule équipe au centre entier, plus le droit d’inviter — tracée au journal d’audit. Elle ajoute `profiles.fonction` et `invitations.fonction`, et `private.can_manage()` perd sa branche par équipe : un gestionnaire gère désormais tout son centre, et le filtre par équipe n’a plus d’objet.

`20260921140000` ne change qu'une ligne de `private.publish_schedule_shift()` : le créneau est désormais lu `for update`. Sans ce verrou, deux publications simultanées lisaient la même `published_revision` et en calculaient la même ; la clé primaire de `schedule_assignments` arrêtait bien la seconde, mais par une violation de contrainte. Le verrou ne porte que sur la ligne du créneau — deux publications sur deux créneaux différents ne s'attendent pas.

`20260919200000` ajoute `public.shift_withdrawals`. Un agent ne peut s’y inscrire que pour lui-même et que sur une garde qu’il tient réellement : `private.holds_published_shift()` exige de figurer dans la révision publiée. Le décideur est estampillé par un déclencheur, jamais par le client, et la table ne touche pas au planning.

Les deux du 21 septembre portent les notifications poussées. `20260921100156` ajoute `public.push_subscriptions` et `public.push_deliveries` : la première n’accepte qu’une adresse de remise d’un service connu, la seconde est une file que **seul le serveur** peut lire — aucun droit n’est donné à une session d’agent, et le déclencheur `private.enqueue_push()` y inscrit un envoi par appareil dès qu’une notification est écrite. `20260921130000` ajoute `public.register_push_subscription()`, la seule façon pour un appareil de s’inscrire : elle lit le centre sur le rattachement actif de l’appelant plutôt que de le croire sur parole, et reprend un téléphone qui a changé de main.

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

### Indicateurs d’attente

Trois attentes différentes, trois indicateurs — les confondre ferait tourner vingt boutons pour un seul geste.

- **Le bouton cliqué.** `Button` regarde ce que son `onClick` lui rend : une promesse, et il s’éteint, affiche son spinner et attend qu’elle se règle. Rien à passer au point d’appel, toutes les commandes rendent une promesse. Un bouton d’envoi ne reçoit pas le clic — c’est le `onSubmit` du formulaire qui travaille — il reçoit alors `pending` ; les formulaires React Hook Form y passent leur `formState.isSubmitting`.
- **L’écran entier.** `provider.tsx` expose `busy`, vrai pendant l’action serveur **et** pendant le `router.refresh()` qui la suit — un `useTransition`, sans quoi l’écran paraîtrait rendu alors que ses données sont encore celles d’avant. Il rend une fine barre balayée en haut de la page, `role="status"`, sans rien masquer : l’écran reste lisible.
- **La navigation.** `src/app/loading.tsx` couvre le premier chargement. Il est à la racine et non dans `(workspace)` : la mise en page du groupe lit toute la base avant de rendre la barre latérale, et un `loading` de groupe n’enveloppe pas la mise en page qui le porte.

Le spinner est un SVG animé par CSS, pas une icône de la bibliothèque : `prefers-reduced-motion: reduce` arrête la rotation et le balayage de la barre, qui reste visible en opacité réduite. Une icône qui tournerait toute seule ne saurait pas s’arrêter. Il porte `aria-hidden` — c’est le texte à côté qui est annoncé.

### Application installable

`src/app/manifest.ts` décrit l'application, ses icônes et deux raccourcis ; `src/components/pwa.tsx` enregistre l'agent de service et propose l'installation depuis l'écran de profil. Les icônes servies viennent du dossier de marque, comme décrit plus haut ; iOS ignore le manifeste et prend `apple-touch-icon.png`.

**L'agent de service ne met aucune donnée en cache.** C'est une décision, pas un raccourci : une disponibilité, une affectation ou un planning servis depuis un cache seraient une information périmée présentée comme à jour, ce qui dans ce métier est pire que pas d'information du tout. Il n'existe que parce qu'un navigateur ne propose l'installation qu'à une application dotée d'un gestionnaire `fetch`, et celui-ci laisse tout passer au réseau. Une seule ressource est conservée, `/hors-ligne`, qui ne contient rien et ne peut donc pas dater. La consultation hors ligne reste une extension à cadrer. L'agent de service a désormais un second rôle, lui aussi sans cache : recevoir les notifications poussées — voir plus bas.

Sur Chrome et ses dérivés, le profil affiche un bouton lorsque le navigateur signale que l'installation est possible. Safari ne le signale jamais : le chemin iOS — Partager, puis « Sur l'écran d'accueil » — est donc écrit en toutes lettres.

### Notifications et envoi des emails

Une notification est écrite au moment où elle est méritée : un déclencheur l'inscrit à l'ouverture d'une campagne, la fonction de publication à la publication, et `public.remind_campaign()` quand un responsable relance. L'envoi est un acte séparé, qui peut échouer.

`public.notifications` sert donc de file d'attente : `sent_at` appartient à l'expéditeur, `read_at` au destinataire. Depuis le 22 septembre, la file a le même modèle que celle des notifications poussées : un état par message (`email_status`), des tentatives, un bail de deux minutes et un délai qui double après chaque échec. **Après chaque commande, une fois la réponse partie**, `src/lib/mailer.server.ts` réserve un lot sous la clé du serveur (`public.claim_email_deliveries()`), envoie **un message à la fois** à Resend avec un délai de dix secondes, et rend chaque résultat (`public.finish_email_delivery()`). Une adresse refusée n'échoue que pour elle ; deux gestionnaires qui publient ensemble ne font plus partir chaque email deux fois ; et un agent qui se désiste est signalé sans attendre le geste d'un gestionnaire. **Sans les trois variables `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL`, aucun email n’est envoyé** : les notifications arrivent dans le centre de l'application, et la file attend. C'est la raison d'être de la file — un envoi raté ne doit pas annuler l'écriture qui l'a provoqué.

`RESEND_API_KEY` est le premier secret du projet. Jamais de préfixe `NEXT_PUBLIC_` : il partirait dans le paquet du navigateur. Lire la file suppose de lire les notifications et les adresses d'autrui, ce qu'aucune policy n'autorise et qu'aucune ne devrait : les deux fonctions de réservation ne sont exécutables que par le serveur (`service_role`), ce qui rend `SUPABASE_SECRET_KEY` nécessaire à l'envoi. `public.pending_notifications()` reste, définisseure et délibérément étroite, pour qu'une session d'encadrement puisse voir ce qui attend.

L'adresse elle-même vient de `auth.users`, que PostgREST n'expose pas. `0006` en garde une copie sur `profiles`, remplie à la création du profil et tenue à jour par déclencheur : l'autorité reste au schéma d'authentification, et aucune session cliente ne peut la modifier.

Le rappel avant clôture est un geste, pas une horloge : personne ne fait tourner de tâche planifiée. Le bouton du tableau de bord vise les agents qui n'ont pas validé, et la base refuse d'empiler deux rappels sur la même personne. L’envoi automatique des invitations n’est pas implémenté : l’administrateur transmet encore l’adresse de l’application à l’agent. Les emails de confirmation d’inscription sont gérés séparément par Supabase Auth.

### Notifications poussées sur le téléphone (Web Push)

Un email se lit quand on ouvre sa boîte, et le centre de messages quand on ouvre l'application. Ni l'un ni l'autre ne prévient l'agent qui n'a rien ouvert — or c'est exactement lui que vise une campagne qui s'ouvre ou un planning qui change. La notification poussée arrive sur l'écran verrouillé, application fermée.

**L'abonnement appartient à l'appareil, pas au compte.** Chaque téléphone s'active séparément, depuis « Mon profil ». C'est une conséquence du protocole — le navigateur crée l'abonnement, pas le serveur — et c'est aussi ce qu'on veut : le poste partagé du centre n'a pas à sonner la nuit parce qu'un agent a coché une case chez lui.

**La question se pose d'elle-même, une fois, à la connexion.** Une case dans un écran de réglages n'est trouvée que par qui la cherche, or celui qu'il faut prévenir d'une campagne est justement celui qui n'ouvre pas l'application. Une fenêtre se présente donc à l'arrivée dans l'espace de travail — une seconde après l'affichage, pour ne pas récolter un geste destiné à autre chose — et **la réponse est gardée sur l'appareil** : elle ne revient pas à la connexion suivante. Fermer la fenêtre vaut refus, et la fenêtre le dit ; le profil garde le bouton pour revenir sur ce choix à tout moment.

Cette réponse est la seule chose que l'application conserve dans le navigateur (`localStorage`, clé `disposp-push-invite:<compte>`). Elle y est à sa place : comme l'abonnement, elle parle de l'appareil. Quelqu'un qui refuse sur l'ordinateur du centre doit pouvoir accepter sur son téléphone le soir même, et l'identifiant dans la clé évite qu'un poste partagé réponde pour le suivant. Perdue — navigation privée, cache effacé —, la question se repose simplement ; elle ne peut jamais faire afficher un planning périmé. L'activation, le refus du système et la désactivation depuis le profil écrivent tous cette réponse : aucun de ces gestes ne se fait redemander.

La chaîne, de bout en bout :

1. L'appareil s'abonne auprès de son service de remise (Google, Apple, Mozilla) et poste le résultat à `POST /api/push/subscribe`, qui appelle `public.register_push_subscription()`. Le centre n'est pas demandé au navigateur : il est lu sur le rattachement actif de la session.
2. Une notification est écrite, comme avant. Le déclencheur `private.enqueue_push()` inscrit **un envoi par appareil déjà abonné** dans `public.push_deliveries`. Aucun rattrapage : activer les notifications ne fait pas remonter les messages d'hier.
3. `src/lib/push.server.ts` réserve un lot de dix envois (`public.claim_push_deliveries()`), les signe avec la clé VAPID et les remet aux services de remise, puis estampille chacun (`public.finish_push_delivery()`).
4. `public/sw.js` reçoit le message et affiche la bulle. Un clic amène au premier plan la fenêtre déjà ouverte plutôt que d'en ouvrir une seconde.

**Ce qui part est délibérément pauvre.** Un écran verrouillé se lit par-dessus l'épaule : le message dit la nature de l'événement — « Votre planning a été publié ou modifié. » — et rien d'autre. Ni nom, ni motif de désistement, ni date de garde. Le détail est dans l'application, derrière la session.

La file est en base pour la même raison que celle des emails : une notification est méritée au moment où elle est écrite, l'envoi est un acte séparé qui peut échouer. Chaque passage réserve ses envois pour deux minutes — le bail — de sorte que deux traitements simultanés ne poussent jamais le même message deux fois et qu'une interruption ne perde rien. Cinq tentatives espacées, puis l'abandon ; au-delà de vingt-quatre heures, l'envoi est supprimé plutôt que délivré en retard. Un 404 ou un 410 du service de remise efface l'abonnement : l'appareil n'existe plus, le garder ferait échouer tous les envois suivants.

Le traitement part après la réponse de chaque commande (`after()`, dans `src/app/actions.ts`) : l'agent n'attend pas que cinq téléphones aient reçu leur bulle pour voir son écran se mettre à jour, et un service de remise lent ne fait pas échouer une écriture déjà faite. `POST /api/push/dispatch`, protégé par `PUSH_DISPATCH_SECRET`, ouvre le même traitement à un planificateur externe — utile pour rattraper ce qu'un service indisponible a laissé en attente, inutile le reste du temps.

**Configuration.** `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` et `WEB_PUSH_SUBJECT`, plus `SUPABASE_SECRET_KEY` pour le traitement de la file. Sans elles, l'écran de profil n'offre pas l'activation et les notifications restent dans l'application — même principe que pour Resend. La paire de clés se génère une fois :

```bash
node node_modules/web-push/src/cli.js generate-vapid-keys --json
```

Changer la clé publique invalide **tous** les abonnements existants : chaque appareil doit réactiver. Elle part dans le paquet du navigateur, c'est sa raison d'être ; la clé privée, jamais — elle seule autorise à pousser un message sur les téléphones du centre.

**Sur iPhone et iPad, les notifications n'existent que dans l'application installée** (iOS 16.4 et au-delà) : ouverte dans Safari, l'application ne peut même pas les proposer. L'écran de profil le dit et donne le chemin. Sur Android et sur ordinateur, l'onglet suffit.

L'adresse de remise est vérifiée deux fois — par `validPushEndpoint()` et par une contrainte de la table — contre la liste des services connus. Une adresse libre ferait de l'expéditeur un relais HTTP vers l'hôte de son choix, signé de sa clé.

Enfin, un bouton d'essai : activer les notifications ne prouve rien, et sans lui l'agent ne saurait qu'à la prochaine campagne — un mois plus tard — si la bulle arrive vraiment. L'essai n'atteint que ses propres appareils, les policies ne lui rendant que ses abonnements.

### Configuration

Définir les deux variables suivantes dans `.env` en local et dans la configuration de l’hébergeur pour le site déployé :

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=votre-cle-publiable
```

**Il n'existe pas de mode de repli.** Sans ces valeurs l'application s'arrête, et c'est délibéré : un déploiement mal configuré doit se voir. Le mode démonstration, qui affichait douze agents fictifs conservés dans le navigateur, a été retiré — un site en production ne peut donc plus montrer silencieusement de fausses données à la place des vraies.

Les variables `NEXT_PUBLIC_*` sont intégrées au moment de la construction : après modification, reconstruire puis redémarrer ou redéployer l’application. Pour les emails métier, ajouter côté serveur `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL` ; ne jamais préfixer la clé Resend par `NEXT_PUBLIC_`. Pour les notifications poussées, ajouter `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` et `WEB_PUSH_SUBJECT` — la clé publique **doit** porter le préfixe, la privée jamais. `.env.example` décrit chaque variable et sa raison d'être.

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

Configurer l’adresse publique dans Supabase → Authentication → URL Configuration, et les deux gabarits d’e-mail ci-dessus. **Site URL** doit porter l’adresse publique en `https://`, jamais `http://localhost:3000` : c’est elle que `{{ .SiteURL }}` écrit dans chaque message, et un agent qui ouvre le lien sur son téléphone y cherche alors un serveur… sur son téléphone. Le symptôme est sans ambiguïté : « Ce site est inaccessible », `ERR_CONNECTION_REFUSED`.

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

**L'intégration continue ne fournit délibérément aucun projet Supabase**, et cela impose deux choses qu'il est facile de reperdre :

- **Aucun écran de l'espace de travail ne doit être prérendu.** Next l'apprenait par `cookies()`, que le client Supabase finit par appeler — mais sans coordonnées il n'y arrive jamais, `credentials()` levant avant. Le prérendu les prenait donc pour des pages statiques et le build s'arrêtait sur la première : « Error occurred prerendering page "/accueil" ». `readSession()` ouvre maintenant par `await connection()`, qui le dit sans rien supposer de la configuration. `export const dynamic` ferait la même chose, mais la v16 l'a retiré de la configuration de segment.
- **Le sondage de démarrage de Playwright vise `/connexion`, pas la racine.** La racine n'est pas un chemin public : sans coordonnées, le garde y lève et rend une 500, que Playwright ne tient pas pour un serveur prêt. Il attendait ses soixante secondes puis renonçait — sur l'environnement même que ces parcours doivent couvrir.

Avec `.env` et un compte d'essai, la suite navigateur rend 22 parcours passés et 6 sautés. Sans projet Supabase — le cas de l'intégration continue —, les parcours qui demandent une session se sautent d'eux-mêmes et seule la surface publique s'exécute.

**La suite navigateur a fondu avec le mode démonstration**, et il faut le dire franchement : les trente parcours d'interface qu'elle jouait — saisie, validation, affectation, publication, exports — pilotaient douze agents fictifs qui n'existent plus. Ils n'ont pas été remplacés par des tests automatiques ; ils sont devenus les étapes manuelles de [la recette](RECETTE.md). Ce qui reste automatique et sans données : le manifeste, les icônes, l'agent de service et l'adaptation aux écrans.

Les parcours de `tests/e2e/connexion.spec.ts` demandent un projet Supabase joignable et se sautent sans `NEXT_PUBLIC_SUPABASE_URL` — ce qui est le cas de l'intégration continue, qui n'en fournit aucun et vérifie ainsi que la surface publique se sert sans base.

En local, rien à exporter : la configuration Playwright charge `.env` comme Next le fait pour le serveur. Sans cela les deux divergeaient, et des parcours se sautaient en croyant le serveur non configuré alors qu'il l'était — « douze tests ignorés » qui ne voulaient plus rien dire.

Les trois parcours de `pwa.spec.ts` qui demandent une session attendent `E2E_EMAIL` et `E2E_PASSWORD`, un compte d'essai rattaché à un centre. Sans eux ils se sautent, au lieu d'échouer sur un écran de connexion. Celui des notifications poussées demande en plus la clé publique VAPID : un navigateur piloté refuse toute autorisation de notification, le parcours vérifie donc que l'écran ne prétend jamais qu'elles sont actives et qu'il donne toujours la suite — activer, ou rouvrir ce que le navigateur a fermé.

Les règles métier, elles, n'ont rien perdu : elles sont vérifiées contre un vrai PostgreSQL par les 114 tests de `tests/database.test.ts`, migrations et politiques comprises — 190 tests au total au 21 septembre 2026. Le suivi des vérifications et des correctifs figure dans [le rapport d’analyse](ANALYSE_PROJET_2026-09-19.md).

Dans un environnement Windows où `pnpm exec` ne résout pas les exécutables, utiliser `node node_modules/@playwright/test/cli.js install chromium`, puis `node node_modules/@playwright/test/cli.js test`.

Pour placer les navigateurs de test dans le projet sous PowerShell :

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
node node_modules/@playwright/test/cli.js install chromium
node node_modules/@playwright/test/cli.js test
```

Les tests couvrent notamment les validations explicites, la clôture, les disponibilités 24 h, les publications, les exports, l'isolation des organisations en PostgreSQL, la publication contrôlée en base, la résistance à une sauvegarde locale inutilisable, la virtualisation de la synthèse et les parcours utilisateur sur ordinateur et mobile. Pour les notifications poussées : la liste des services de remise acceptés, le contenu envoyé — qui ne doit nommer personne —, l'isolation des abonnements entre agents, la reprise d'un appareil qui change de main, la file d'envoi hors de portée d'une session et l'effacement d'un appareil que le service de remise ne connaît plus. Quatre d'entre eux gardent l'adaptation aux écrans, décrite plus bas. Les tests navigateur fixent l'horloge au 18 septembre 2026 pour rendre la campagne d'exemple reproductible.

### Adaptation aux écrans

Une seule rupture sépare le téléphone de l'ordinateur, à 760 px : en dessous, la barre latérale devient un tiroir et une barre de navigation s'installe en bas. Trois ruptures de confort l'accompagnent — 1200, 1000 et 560 px — et une quatrième, à 1700, élargit la mise en page sur les très grands écrans.

`tests/e2e/responsive.spec.ts` en garde quatre règles. Deux s'exécutent toujours, sur `/connexion` et `/hors-ligne` : aucune page ne dépasse la largeur de l'appareil, aucune commande ne descend sous 24 px de côté. Les deux autres demandent `E2E_EMAIL` et `E2E_PASSWORD` et parcourent alors les quinze écrans de travail, où se trouvent les tableaux, les filtres et les modales — la partie où l'adaptation se joue vraiment. La quatrième mesure une chose qu'aucun débordement ne signale : **un sélecteur trop étroit pour l'option qu'il affiche**. Il ne déborde de rien, il ne coupe aucun texte au sens du navigateur, il affiche simplement « Tout… » et ne dit plus ce qu'il filtre.

Trois défauts corrigés en septembre 2026 valent d'être notés, parce qu'ils reviendront sous la même forme :

- **Une cible de 24 px doit être imposée, jamais espérée.** Une case à cocher de navigateur fait 13 px, un « × » de texte en fait 11. Trois endroits l'avaient oublié — les qualifications d'une fiche agent, les cases des fiches, la croix du bandeau de message.
- **`max-width` en pourcentage sur un élément flexible est un piège sur téléphone.** Les filtres portaient `max-width: 48 %`, ce qui les réduisait à 64 px sur un écran de 320 et à 27 px sur l'historique, où le filtre de période dispute la même rangée. Une base en pixels (`flex: 1 1 145px`) laisse l'élément passer à la ligne plutôt que rétrécir sous le lisible.
- **Un côte à côte qui tient à 600 px ne tient pas à 320.** L'anneau des statistiques laissait 75 px à son texte, un mot par ligne. Il s'empile sous 560 px, et garde la disposition de la maquette au-dessus.

Deux autres sont venus d'une relecture, et ils disent surtout ce qu'une mesure du débordement **horizontal de la page** ne peut pas voir :

- **La hauteur.** Le menu mesure près de 870 px et il est en `position: fixed` : ce qui dépasse le bas de l'écran ne fait déborder aucune page, il sort simplement du cadre. Sans `overflow-y` sur la barre, huit rubriques devenaient inatteignables à 844 × 390 — un portable posé en paysage — et « Paramètres » dès 1024 × 768.
- **L'intérieur d'un conteneur borné.** Une boîte de dialogue masque ce qui la dépasse : la page ne déborde de rien, et le champ est pourtant coupé. « Clôture des réponses » sortait de 47 px à 320 px, parce qu'un champ `month` réclame 173 px avant de pouvoir s'afficher et qu'un élément de grille ne se comprime jamais sous sa largeur intrinsèque. Les grilles de formulaire s'empilent donc sur téléphone.

Les deux règles correspondantes mesurent, l'une la position des liens du menu après l'avoir poussé jusqu'au bout, l'autre le `scrollWidth` de la boîte de dialogue elle-même. Chacune a été vérifiée en retirant son correctif : sans eux, six rubriques hors d'atteinte et 49 px de débordement.

## Limites et prochaines étapes

Les dix-neuf migrations sont appliquées et l’application lit et écrit les données en mode connecté. Les étapes restantes sont suivies dans [le plan de développement](PLAN_DEVELOPPEMENT.md), et la vérification avant mise en service dans [la recette](RECETTE.md) :

- Confirmer la configuration du site hébergé et effectuer une recette avec plusieurs comptes : invitation, confirmation d’adresse, disponibilités habituelles, validation, publication, réception des emails et des notifications poussées sur un téléphone.
- Déployer la version qui appelle `public.create_campaign()`, `public.save_availability_template()` et `public.apply_availability_template()`, puis vérifier ces parcours en mode connecté : les migrations sont appliquées, le comportement hébergé reste à observer.
- Finaliser la mise en service : configuration de l’expéditeur, suivi des échecs d’envoi, sauvegardes/restauration et règles de conservation des données.

Les deux files d'envoi — emails et notifications poussées — se vident après chaque commande, par lots successifs tant que la base en rend un plein, et rien ne tourne tout seul entre deux commandes. `POST /api/push/dispatch` est là pour qu’un planificateur externe rattrape ce qu’un service de remise indisponible aurait laissé en attente ; aucun n’est configuré à ce jour. Les deux migrations Web Push sont appliquées ; il reste à déclarer les clés VAPID sur l’hébergeur et à vérifier la réception sur un vrai téléphone.

**Les messages d’activation et de réinitialisation ne passent pas par Resend** : ils sont envoyés par Supabase Auth, avec son propre expéditeur. Deux gabarits sont à régler dans Authentication → Email Templates, faute de quoi les liens ne fonctionnent que sur l’appareil qui a fait la demande — or ce n’est jamais le cas pour une activation, demandée par le gestionnaire et ouverte par l’agent :

| Gabarit          | Lien à mettre                                                                |
| ---------------- | ---------------------------------------------------------------------------- |
| `Invite user`    | `{{ .SiteURL }}/auth/activation?token_hash={{ .TokenHash }}&type=invite`     |
| `Reset password` | `{{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&type=recovery` |

**Le corps de ces messages est modifiable, et il l’est.** Les gabarits d’origine sont en anglais et ne nomment pas le centre ; un agent qui reçoit « You've been invited » d’un expéditeur inconnu a toutes les raisons de le prendre pour du hameçonnage. `supabase/templates/` porte les deux corps français, dans le registre des emails que l’application envoie déjà — même police, même logo servi depuis l’application, même sobriété :

| Gabarit          | Fichier à coller                           | Sujet à mettre                     |
| ---------------- | ------------------------------------------ | ---------------------------------- |
| `Invite user`    | `supabase/templates/invitation.html`       | `DispoSP — votre accès est ouvert` |
| `Reset password` | `supabase/templates/reinitialisation.html` | `DispoSP — nouveau mot de passe`   |

Ils vivent dans le dépôt et non seulement dans le tableau de bord : un gabarit qu’on ne peut pas relire est un gabarit que personne ne corrige. `tests/email.test.ts` vérifie qu’ils portent bien le lien attendu et **aucune adresse en dur** — un `localhost` oublié là enverrait chaque agent sur son propre téléphone.

Le troisième gabarit, `Confirm signup`, garde sa version d’origine : il ne sert qu’au tout premier compte, celui qui s’inscrit lui-même avant qu’un centre existe, et son lien s’ouvre sur l’appareil qui vient de le demander.

**L’expéditeur, lui, ne se change pas dans un gabarit.** `noreply@mail.app.supabase.io` est le relais intégré de Supabase, et il est aussi limité à quelques messages par heure — de quoi fausser une recette. Pour envoyer depuis votre domaine : Project Settings → Authentication → SMTP Settings, avec les coordonnées Resend (`smtp.resend.com`, port 465, utilisateur `resend`, mot de passe `RESEND_API_KEY`). L’adresse d’expédition doit appartenir à un domaine vérifié chez Resend ; tant qu’il ne l’est pas, le relais de Supabase reste le seul chemin.

**L’authentification unique est écrite mais pas joignable.** `signInWithSSO()` route sur le domaine de l’adresse saisie ; tant qu’aucun fournisseur SAML n’est déclaré côté Supabase — ce qui suppose un plan payant et la CLI — l’écran affiche l’explication et renvoie au mot de passe.

**La réinitialisation du mot de passe fonctionne sur les deux chemins**, mais l’un demande un réglage. Le gabarit d’e-mail par défaut renvoie un code lié au navigateur qui a fait la demande : ouvrir le message sur un autre appareil échoue. Pour couvrir ce cas, régler le gabarit « Reset password » de Supabase sur `{{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&type=recovery`, ce que la route serveur du même nom sait vérifier quel que soit l’appareil.

Les désistements sont implémentés ; les **échanges nommés** entre agents — « je te donne ma garde, tu prends la mienne » — ne le sont pas : un agent signale qu’il ne peut plus tenir une garde, l’encadrement réaffecte.

Le retrait d'un compte et de ses données se fait par `supabase/provisioning/retirer-un-compte.sql`, dans l'éditeur SQL du tableau de bord. Il efface dans l'ordre des dépendances, refuse de laisser un centre sans administrateur actif, et garde les lignes du journal d'audit en retirant les coordonnées qu'elles avaient recopiées ; c'est la suppression du compte lui-même, à la main, qui en anonymise l'auteur.

Les autres procédures liées aux données personnelles — export des données d'un compte, purge des données arrivées au terme de leur durée de conservation — et ce qu'il reste à valider avec le DPO sont dans [docs/RGPD.md](docs/RGPD.md).

### Quitter le centre d'essai

**Le nom d'un centre n'est modifiable par aucune session** : la migration `0003` ne donne au client le droit d'écrire que les horaires. Passer d'un centre d'essai à un vrai centre est donc une opération d'éditeur SQL, en trois temps :

1. `supabase/provisioning/inventaire-du-centre.sql` — ne modifie rien. Il compte ce que le centre d'essai contient, table par table, et liste qui y est rattaché. On regarde ce qu'on s'apprête à perdre avant de le perdre.
2. `supabase/provisioning/basculer-vers-un-vrai-centre.sql` — crée le vrai centre avec sa section, ses horaires et son catalogue de qualifications, y rattache les comptes que vous nommez, puis **efface le centre d'essai et tout ce qu'il contient**. Irréversible, et atomique : une erreur annule la création comme l'effacement.
3. `supabase/provisioning/premiere-campagne.sql` — ouvre la première campagne du nouveau centre. Sans campagne, tous les écrans affichent celui qui l'explique.

Trois points à connaître avant de lancer le second.

**Les horaires du centre d'essai sont repris.** S'ils avaient été réglés pour de bon, les recréer à 8 h et 20 h serait une régression que personne ne remarquerait avant la première campagne.

**Les comptes d'authentification ne sont jamais supprimés.** Ceux qui ne sont pas repris restent, sans rattachement : ils peuvent se connecter, et l'application leur dit qu'ils n'appartiennent à aucun centre. `retirer-un-compte.sql` puis Authentication → Users les font disparaître pour de bon. **Le compte de recette (`E2E_EMAIL`) doit figurer parmi les comptes repris**, sans quoi les parcours navigateur qui demandent une session se sauteront.

**L'effacement suit l'ordre des dépendances, et il est vérifié.** Toutes les clés étrangères de ce schéma sont en `on delete restrict` : rien ne part en cascade, une table oubliée fait échouer la transaction entière. `tests/provisioning.test.ts` exécute **le fichier lui-même** contre un centre peuplé — campagne close et verrouillée, planning publié, désistement, appareil abonné, journal d'audit — et vérifie qu'il ne reste rien. Il vérifie aussi que le garde des disponibilités, mis en sommeil le temps de l'effacement (il refuse toute écriture sur une campagne close, y compris un effacement), est bien rendu ensuite.

## Références de mise en œuvre

- [Installation Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [Authentification Supabase côté serveur](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Sécurisation de l'API Supabase](https://supabase.com/docs/guides/api/securing-your-api)
- [Changelog Supabase](https://supabase.com/changelog)
- [Applications web progressives avec Next.js](https://nextjs.org/docs/app/guides/progressive-web-apps) — manifeste, agent de service et notifications poussées
- [Protocole Web Push et clés VAPID](https://developer.mozilla.org/fr/docs/Web/API/Push_API)
