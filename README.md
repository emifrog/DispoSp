# DispoSP

Application de disponibilités et de planification des sapeurs-pompiers, branchée sur Supabase. L'état du projet est dans [la dernière analyse](docs/ANALYSE_PROJET_2026-10-27.md) ; les évolutions d'octobre 2026 — rappels automatiques, publication du mois, appels à remplacement, agenda abonné — sont cadrées par [la spécification des évolutions opérationnelles](docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md). [Le plan de développement](PLAN_DEVELOPPEMENT.md) date du 22 septembre 2026 et n'a pas été tenu à jour depuis : il décrit le socle, pas l'état courant.

## Démarrer

Prérequis : Node.js 22 et pnpm. Les versions des dépendances et le fichier de verrouillage sont enregistrés.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir http://127.0.0.1:3000. Pour vérifier une version de production : `pnpm build`, puis `pnpm start`.

**Les notifications poussées demandent une version de production.** En développement, l'agent de service n'est pas enregistré au chargement — il survivrait aux rechargements et brouillerait la lecture de ce qui vient du serveur ; le bouton d'activation l'enregistre alors à la demande. `127.0.0.1` est traité comme une origine sûre, donc l'essai fonctionne en local.

L'application demande un compte. Sans session, toute adresse renvoie vers l'écran de connexion — hormis ce qu'un navigateur va chercher avant d'en avoir une (le manifeste, l'agent de service, la page hors ligne, `installation.js`), les écrans où l'on arrive précisément sans session (activation, réinitialisation, confirmation d'un lien), les deux routes qu'un planificateur appelle avec son propre secret (`/api/push/dispatch`, `/api/traitements`) et le flux d'agenda abonné, dont le jeton est dans l'adresse. Aucune donnée métier n'est conservée dans le navigateur : l'état vient du rendu serveur, relu à chaque navigation. Une seule chose y reste, et elle ne parle pas du centre : la réponse donnée à l'invitation d'activer les notifications sur cet appareil.

## Parcours livrés

- Connexion par mot de passe, réinitialisation en cas d’oubli, authentification unique SAML par domaine et déconnexion ; lecture et écriture des données Supabase selon les droits du compte.
- Arrivée d’un agent : le gestionnaire renseigne la fiche et envoie l’invitation, l’agent reçoit un message d’activation, choisit son mot de passe et rejoint son centre avec le rôle prévu. **Personne ne choisit ni ne transmet le mot de passe d’un agent.** L’invitation en attente se renvoie ou s’annule.
- Accueil agent : campagne en cours, avancement de la saisie, prochaines gardes publiées et accès rapides. La racine aiguille selon le rôle — accueil pour un agent, tableau de bord pour qui encadre.
- Tableau de bord distinguant la couverture potentielle (disponibilités validées) de la couverture planifiée (affectations du brouillon). Indicateurs déficit, limite et couvert, plus un état « Besoins non définis ».
- Calendrier agent : cinq états, commentaire, remise à non renseigné ; saisie rapide par période ou par semaine type (`public.apply_week()`, une écriture pour tout le mois, en épargnant au besoin les jours déjà renseignés).
- Disponibilités habituelles enregistrées par agent et réutilisables dans une campagne. Leur application remplit le calendrier ; elle ne valide pas la réponse et ne crée aucune affectation.
- Validation explicite d’une campagne complète ; invalidation après modification ; verrouillage après clôture.
- Synthèse virtualisée avec colonne agent fixe, tri, recherche, filtres équipe/validation, totaux et vue par journée avec listes nominatives.
- Construction du planning par date et créneau : affectation/retrait, besoins d’effectifs et de qualifications, répartition Jour/Nuit/24 h.
- Publication par créneau ou du mois entier, avec une seule définition d'un créneau publiable (effectif, qualifications, disponibilité validée ou déclaration exceptionnelle, agent actif, désistement, repos) et une version indépendante du brouillon ; planning personnel limité aux affectations publiées.
- Règle de repos du centre : après une garde, autant de repos qu'elle a duré (24 h après un Jour et une Nuit de la même date), contrôlée à chaque publication et à chaque candidature.
- Campagnes : création, sélection, verrouillage ; paramètres horaires appliqués aux nouvelles campagnes.
- Besoins du mois sur un écran : effectifs et minima par qualification, journée par journée, avec application en lot à une sélection de jours de semaine.
- Statistiques sous trois angles : mois par mois sur l’ensemble des campagnes, par jour de semaine pour repérer les trous réguliers, et par agent.
- Désistements : un agent signale qu’il ne peut plus tenir une garde publiée, l’encadrement tranche. Accepter ne réaffecte pas — le remplacement se fait au planning, ou par un appel à remplacement lancé dans le même geste, et l’écran le rappelle tant qu’il n’est pas fait.
- Appels à remplacement et à renfort : sollicitation des agents dont la disponibilité validée couvre la garde, élargissement aux autres sur déclaration exceptionnelle, propositions, sélection dans le brouillon et confirmation par publication ; écran « Appels » pour l'agent.
- Administration des agents, fiches avec grade, fonction, matricule, téléphone et conduite (COD SSR, PL, COD2, COD6, tenue comme une qualification), équipes, trois rôles, qualifications, invitations et désactivation/réactivation. L'encadrement ne prend pas de garde : seuls les agents sont inscrits aux campagnes (décision du 16 octobre 2026).
- Historique filtrable par sujet, auteur et recherche ; centre de notifications avec suivi de lecture et envoi des emails via Resend lorsqu’il est configuré.
- Rappels automatiques par centre (garde la veille, relances 48 h et 24 h avant la clôture), générés par Supabase Cron et livrés par `/api/traitements` ; suivi des passages dans Paramètres.
- Photographies pour le bilan : à chaque publication, à la clôture et au début de chaque créneau, des faits sans identifiant et des détails par personne, dans des tables réservées au serveur.
- Notifications poussées sur le téléphone, application fermée, une fois activées depuis le profil sur l’appareil concerné.
- Exports CSV, ICS et Excel, agenda personnel abonné (adresse privée, flux des gardes publiées) ; impression complète de la matrice mensuelle, de la vue par journée et du planning personnel pour enregistrer un PDF.
- Interface adaptée aux ordinateurs et téléphones, de 320 px au grand écran ; dialogues accessibles au clavier.

## Règles retenues

Voir [docs/DECISIONS_FONCTIONNELLES.md](docs/DECISIONS_FONCTIONNELLES.md). Jour 8 h–20 h, Nuit 20 h–8 h le lendemain, nuit rattachée à sa date de début. Une disponibilité 24 h couvre ces deux créneaux sans créer d'affectation. Les horaires sont configurables et appliqués aux nouvelles campagnes ; les créneaux des campagnes existantes sont conservés.

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
- `src/lib/supabase/` : fabriques de clients et middleware de session. `publicPaths` liste ce que le garde ne doit jamais intercepter — connexion, déconnexion, choix d'un nouveau mot de passe, activation et confirmation d'un lien, manifeste, agent de service, `installation.js`, page hors ligne, et les deux routes à secret `/api/push/dispatch` et `/api/traitements` ; le flux d'agenda abonné (`calendarFeedPath`) passe aussi, sans appel au service de connexion. Les écrans de mot de passe et d'activation en font partie parce qu'on y arrive précisément sans session. **L'ordre compte** : le garde regarde le chemin avant d'exiger la configuration Supabase, sinon un environnement qui n'en a pas — l'intégration continue — échouerait jusqu'à servir le manifeste. La moitié inverse de la décision tient toujours : un écran de travail sans configuration s'arrête au lieu de s'afficher vide. `tests/middleware.test.ts` garde les deux.
- `src/lib/session.ts` et `src/lib/session.server.ts` : types partagés d'un côté, lecture de session de l'autre. La séparation est nécessaire — un composant client qui importerait `next/headers` casse la compilation.
- `supabase/migrations/` : 40 migrations ; 26 tables dans `public` — organisations, équipes, profils, droits, campagnes, participants, disponibilités, qualifications, créneaux types, besoins d'effectifs et de qualifications, plannings, affectations, désistements, invitations, disponibilités habituelles, notifications, abonnements des appareils, file des envois poussés, audit, appels (`shift_calls`, `call_recipients`, `call_proposals`) et abonnements d'agenda — et 11 dans `private`, hors de portée de toute session : réservations d'envoi, rappels, journal des passages planifiés, publications du mois et photographies. Isolation RLS, validation, invalidation et publication contrôlées en base.
- `.github/workflows/ci.yml` : formatage, lint, types, tests unitaires et schéma, la même suite rejouée en UTC (hors base), build et tests de bout en bout à chaque push et chaque pull request.

## Configuration et fonctionnement Supabase

Le projet de développement dédié est désigné : ses coordonnées sont dans `.env`, qui n'est pas versionné. En mode connecté, l'URL et la clé publiable sont incluses dans le paquet livré au navigateur — c'est le fonctionnement prévu de ces deux valeurs, la clé publiable ne donne accès qu'à ce que les policies RLS autorisent. **Aucune clé secrète ne descend dans le navigateur.**

### La clé secrète, et à quoi elle sert

`SUPABASE_SECRET_KEY` est entrée dans le projet pour une seule chose, **créer le compte d'un agent invité** — une opération d'administration que la clé publiable ne peut pas faire par construction ; sans elle, il faudrait soit ouvrir l'inscription à tout venant, soit qu'un tiers choisisse le mot de passe d'un agent, deux choses écartées. Elle sert aujourd'hui à cinq travaux, tous côté serveur, et tous sans session d'utilisateur à qui les imputer :

| Usage                                                 | Où                                                           | Ce qu'elle appelle                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Inviter un agent, rendre un envoi qui n'est pas parti | `src/lib/supabase/admin.server.ts`, par `commands.server.ts` | `auth.admin.inviteUserByEmail`, `release_invitation_send`                    |
| Vider la file des emails                              | `src/lib/mailer.server.ts`                                   | `claim_email_deliveries`, `finish_email_delivery`, `release_email_delivery`  |
| Vider la file des notifications poussées              | `src/lib/push.server.ts`                                     | `claim_push_deliveries`, `finish_push_delivery`                              |
| Le passage de livraison planifié                      | `src/app/api/traitements/route.ts`                           | `cancel_obsolete_notifications`, `record_scheduled_run`, puis les deux files |
| Servir un agenda abonné                               | `src/app/api/agenda/[jeton]/route.ts`                        | `calendar_feed_events`                                                       |

Cette clé passe outre toutes les policies RLS. Trois précautions la cantonnent, et elles se tiennent ensemble :

- Elle ne vit que dans des modules `server-only` ou des routes serveur ; jamais de préfixe `NEXT_PUBLIC_`, sans quoi elle partirait dans le paquet du navigateur.
- Aucun de ces clients ne lit ni n'écrit une table directement : chacun n'appelle que des fonctions accordées au seul `service_role`, qui font une chose précise. Une lecture libre faite avec elle contournerait le cloisonnement entre centres sans que rien ne le signale.
- Les files se réservent sous bail et les fonctions revérifient ce qu'elles touchent : un passage qui s'interrompt ne perd rien et n'envoie rien deux fois.

Elle est facultative pour démarrer. Sans elle, l'invitation enregistre toujours qui est attendu — l'agent ne reçoit simplement pas son message, et le gestionnaire le lit à l'écran — mais aucun email ni notification poussée ne part, la livraison planifiée répond 503 et le flux d'agenda aussi.

### Migrations

Le schéma est découpé en migrations successives, à appliquer dans l'ordre et une seule fois chacune :

| Fichier                                                                           | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | État                                                                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/0001_foundation.sql`                                         | Organisations, équipes, profils, droits, campagnes, participants, disponibilités                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Appliquée le 18 septembre 2026                                                                                        |
| `supabase/migrations/0002_planning.sql`                                           | Qualifications, créneaux types, besoins, plannings, affectations, notifications, audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Appliquée le 18 septembre 2026                                                                                        |
| `supabase/migrations/0003_client_writes.sql`                                      | Publication joignable depuis le client, horaires du centre, catalogue de qualifications, journal d'audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Appliquée le 18 septembre 2026                                                                                        |
| `supabase/migrations/0004_agent_administration.sql`                               | Fiche agent, invitations, administration des équipes et qualifications                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Appliquée le 18 septembre 2026                                                                                        |
| `supabase/migrations/0005_notifications.sql`                                      | Notification à l'ouverture d'une campagne                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Appliquée le 18 septembre 2026                                                                                        |
| `supabase/migrations/0006_email_dispatch.sql`                                     | Adresse des agents, file d'envoi, rappel avant clôture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Appliquée le 18 septembre 2026                                                                                        |
| `supabase/migrations/0007_availability_templates.sql`                             | Disponibilité habituelle par jour de semaine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260918151529_atomic_campaign_creation.sql`                 | Création atomique des campagnes, plannings, créneaux et participants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260918180846_atomic_availability_templates.sql`            | Enregistrement et application atomiques de la disponibilité habituelle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260919120000_grades_fonctions_roles.sql`                   | Trois rôles au lieu de quatre, séparation du grade et de la fonction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260919200000_desistements.sql`                             | Désistements sur une garde publiée, leurs notifications et leur audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260920090000_correctifs_droits_et_besoins.sql`             | Ferme l'escalade par invitation ; rend l'écriture d'un besoin atomique                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260920140000_invitation_compte_existant.sql`               | Rattache un invité dont le compte existe déjà                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260921090000_eligibilite_publication.sql`                  | Contrôle d'éligibilité à la publication d'une garde                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260921100156_web_push_notifications.sql`                   | Abonnements des appareils, file des envois poussés et son traitement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260921130000_web_push_abonnement.sql`                      | Inscription d'un appareil par la session qui le tient                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Appliquée — confirmation du porteur du projet                                                                         |
| `supabase/migrations/20260921140000_verrou_publication.sql`                       | Verrou de ligne sur le créneau publié, contre deux publications simultanées                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Appliquée le 22 septembre 2026                                                                                        |
| `supabase/migrations/20260922100000_reactivation_administrateur_devalidation.sql` | Fiche des membres désactivés ouverte à l'encadrement ; dernier administrateur protégé ; dévalidation sous la même fenêtre que la validation, journalisée                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Appliquée le 22 septembre 2026                                                                                        |
| `supabase/migrations/20260922150000_rattachement_retrait_file_email.sql`          | Un seul centre actif par compte, invitation d'un compte actif ailleurs refusée, membre désactivé réinvité réactivé ; retrait d'un compte possible (invitations) ; file d'emails avec bail, tentatives et état                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Appliquée le 22 septembre 2026                                                                                        |
| `supabase/migrations/20260923090000_fiche_agent_atomique.sql`                     | `public.save_member()` : rattachement, profil et qualifications d'un agent écrits en une seule transaction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Appliquée le 23 septembre 2026                                                                                        |
| `supabase/migrations/20260923140000_limites_envois.sql`                           | Limites d'envoi : un rappel par campagne toutes les 12 h ; invitations espacées d'un quart d'heure, cinq envois au plus, cinquante par heure et par centre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Appliquée le 23 septembre 2026                                                                                        |
| `supabase/migrations/20260923180000_rendre_envoi_invitation.sql`                  | Un envoi d'invitation qui n'est pas parti est rendu (`release_invitation_send`, réservée au serveur) : il ne compte plus dans les limites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Appliquée le 23 septembre 2026                                                                                        |
| `supabase/migrations/20260923200000_relances_et_plafonds.sql`                     | Relances : campagne ouverte, membres actifs, sans dépendre de l'envoi du précédent. Invitations limitées par adresse, même effacées. Désistement refait sans renotifier. Dix emails par heure et par destinataire                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Appliquée le 23 septembre 2026                                                                                        |
| `supabase/migrations/20260924090000_campagne_unique.sql`                          | Une campagne par mois et par équipe (index unique) ; refuse de s'appliquer, en le disant, si un doublon existe déjà                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Appliquée — confirmation du porteur du projet, 25 septembre 2026                                                      |
| `supabase/migrations/20260925090000_participants_en_cours.sql`                    | Un membre qui devient actif dans une équipe — invitation, réactivation, changement d'équipe — est inscrit aux campagnes encore ouvertes de cette équipe, et prévenu ; rattrape ceux qui sont déjà arrivés trop tard                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Appliquée le 25 septembre 2026                                                                                        |
| `supabase/migrations/20260925150000_desistements_notification.sql`                | Une demande de désistement porte la date de la base, jamais celle de l'agent (droit d'insertion limité à quatre colonnes) ; une nouvelle demande après un refus prévient de nouveau l'encadrement — seule une demande retirée par l'agent dispense de le faire dans les douze heures                                                                                                                                                                                                                                                                                                                                                                                                | Appliquée le 25 septembre 2026                                                                                        |
| `supabase/migrations/20260925180000_correctifs_mineurs.sql`                       | Décision d'un désistement limitée à accepter ou refuser ; ancienne file d'emails fermée aux sessions ; `save_member` et `set_staffing_requirement` retirées à `anon` ; effectif refusé sous un minimum de qualification ; campagne commençant le premier du mois ; noms de qualification nettoyés. Refuse de s'appliquer, en le disant, si une campagne existante ne commence pas le premier                                                                                                                                                                                                                                                                                        | Appliquée le 25 septembre 2026                                                                                        |
| `supabase/migrations/20260927090000_correctifs_bilan.sql`                         | Bilan du 27 septembre : un appareil se réinscrit sans perdre ses envois et ne change de compte que s'il est réclamé (`register_push_subscription` prend `claim`) ; un agent retiré à la republication est prévenu ; la fiche d'un agent actif dans un autre centre n'est plus modifiable par l'ancien ; clé d'idempotence par email (`notifications.email_key`), 409 réessayé                                                                                                                                                                                                                                                                                                       | Appliquée — confirmation du porteur du projet, 1er octobre 2026                                                       |
| `supabase/migrations/20261005090000_reactivation_admin_deverrouillage.sql`        | Analyse du 5 octobre : seul un administrateur réactive un administrateur ; déverrouiller une campagne avant sa clôture y inscrit les membres actifs de l'équipe arrivés pendant le verrou, et les prévient ; rattrape ceux qui sont déjà dans ce cas                                                                                                                                                                                                                                                                                                                                                                                                                                | Appliquée — confirmation du porteur du projet, 8 octobre 2026                                                         |
| `supabase/migrations/20261005120000_suspension_file_email.sql`                    | Analyse du 5 octobre : un refus de Resend qui vise le compte — domaine non vérifié, clé, quota — suspend la file au lieu de la solder en échec (`release_email_delivery`, réservée au serveur) ; les messages repartent une fois le compte corrigé, trois jours au plus                                                                                                                                                                                                                                                                                                                                                                                                             | Appliquée — confirmation du porteur du projet, 8 octobre 2026                                                         |
| `supabase/migrations/20261007090000_conduite.sql`                                 | La conduite (COD SSR, PL, COD2, COD6) : saisie à l'invitation (`invitations.conduite`, liste fermée), elle devient une qualification de l'agent quand il rejoint le centre, par l'un ou l'autre chemin ; une seule par agent, tenue par la base ; exigible dans les besoins d'une garde comme toute qualification                                                                                                                                                                                                                                                                                                                                                                   | Appliquée — confirmation du porteur du projet, 8 octobre 2026                                                         |
| `supabase/migrations/20261007150000_droits_par_ensemble.sql`                      | Audit de performance du 7 octobre : les règles d'accès ne rappellent plus une fonction de droits pour chaque ligne lue, elles testent l'appartenance à l'ensemble des centres de l'appelant, calculé une fois par requête (`private.my_organizations()`, `private.managed_organizations()`). Mêmes droits ; sur un centre de 80 agents, les affectations se lisent en 0,14 s au lieu de 13,6 s                                                                                                                                                                                                                                                                                      | Appliquée — confirmation du porteur du projet, 8 octobre 2026                                                         |
| `supabase/migrations/20261016150000_encadrement_hors_campagnes.sql`               | Décision C6 : l'encadrement ne prend pas de garde. Seuls les agents sont inscrits aux campagnes — création, arrivée, retour au rôle d'agent, déverrouillage — et relancés (`private.takes_shifts()`) ; le rattrapage retire l'encadrement des campagnes non closes où il n'a rien saisi, et signale celui qui a saisi                                                                                                                                                                                                                                                                                                                                                               | Appliquée — confirmation du porteur du projet, 20 octobre 2026                                                        |
| `supabase/migrations/20261016200000_semaine_type.sql`                             | Revue d'ergonomie, C4 : `apply_week()` applique une semaine type — une valeur par jour de semaine — sur une période de la campagne, en une seule écriture, en épargnant au besoin les jours déjà renseignés. La saisie rapide l'appelle (onglet « Semaine type »)                                                                                                                                                                                                                                                                                                                                                                                                                   | Appliquée — confirmation du porteur du projet, 20 octobre 2026                                                        |
| `supabase/migrations/20261020090000_traitements_planifies.sql`                    | Lot A des évolutions opérationnelles : rappel de garde la veille et relances 48 h puis 24 h avant la clôture, créés en base par Supabase Cron (`private.generate_due_notifications()`) pour les centres qui les activent (`organizations.reminders_enabled`, `shift_reminder_hour` ; désactivés par défaut, réglage journalisé) ; une clé par événement (`notifications.event_key`, unique) ; un rappel devenu faux est écarté avant toute réservation d'envoi ; journal des passages et état lisible par l'encadrement (`public.scheduled_status()`). Le code en dépend : à appliquer **avant** de déployer                                                                        | Appliquée — confirmation du porteur du projet, 21 octobre 2026                                                        |
| `supabase/migrations/20261020150000_photographies.sql`                            | Lot A, seconde partie : les photographies que lira le bilan. À chaque publication d'un créneau, à la date de clôture d'une campagne et au début de chaque créneau, un fait sans identifiant (besoin, minima, effectifs, couverture) et des détails par personne (affectés et leurs qualifications, participants attendus). Prises dans la transaction de la publication, au passage planifié, et avant toute modification qui changerait ce qu'elles retiennent. Aucun code de l'application n'en dépend ; les scripts de retrait, de purge, de bascule et d'export la supposent : à appliquer après 20261020090000                                                                 | Appliquée — confirmation du porteur du projet, 21 octobre 2026                                                        |
| `supabase/migrations/20261020200000_publication_du_mois.sql`                      | Lot B : publier le mois. Une seule définition d'un créneau publiable (`private.shift_blockers()`), partagée par la publication unitaire — mêmes refus qu'avant — et par celle du mois ; un aperçu (`public.month_publication_preview()`) qui classe chaque créneau prêt, bloqué ou inchangé ; la publication des seuls créneaux prêts en une transaction (`public.publish_month()`), refusée sur un aperçu périmé, rejouée sans effet pour une même demande ; un avis par agent dont les gardes changent, et plus d'avis par créneau. Le code en dépend : à appliquer **avant** de déployer                                                                                         | Appliquée — confirmation du porteur du projet, 21 octobre 2026                                                        |
| `supabase/migrations/20261021090000_appels_remplacement.sql`                      | Lot C : la règle de repos du centre (autant de repos que la garde a duré, décision du 21 octobre), dans la définition partagée d'un créneau publiable — publication unitaire, du mois et candidature ; les appels à remplacement et à renfort (`public.shift_calls`, destinataires, propositions), ouverts depuis un désistement ou un créneau insuffisant, élargis sur geste du gestionnaire ; la déclaration exceptionnelle d'un agent sans disponibilité validée, preuve acceptée à la publication ; la fermeture de l'appel par la publication qui couvre le besoin, son annulation, son expiration au début de la garde. Le code en dépend : à appliquer **avant** de déployer | Appliquée — confirmation du porteur du projet, 21 octobre 2026                                                        |
| `supabase/migrations/20261021150000_agenda_abonne.sql`                            | Lot D : l'agenda personnel abonné. Un abonnement par agent à la fois (`public.calendar_feeds`), révocable ; la base ne garde que le condensat SHA-256 du jeton. Le flux (`public.calendar_feed_events()`, réservé au serveur) rend les gardes publiées encore tenues, de trois mois en arrière à douze en avant, et rien dès que l'abonnement est révoqué ou que l'agent n'est plus membre actif qui prend des gardes. Le code en dépend : à appliquer **avant** de déployer                                                                                                                                                                                                        | Appliquée — confirmation du porteur du projet, 21 octobre 2026 ; vérifiée en lecture seule le 27 octobre              |
| `supabase/migrations/20261027090000_verrou_repos.sql`                             | Verrou par agent sur la règle de repos : la publication d'un créneau, celle du mois et la proposition à un appel verrouillent chaque agent concerné le temps de la transaction, dans un ordre fixe. Sans lui, deux publications simultanées de deux créneaux différents pouvaient publier le même agent sans son repos. Aucun droit ni écran ne change ; le code ne dépend pas de cette migration                                                                                                                                                                                                                                                                                   | Appliquée — confirmation du porteur du projet, 27 octobre 2026 ; non vérifiable en lecture seule (aucun objet public) |

Les deux migrations du 18 septembre n’ajoutent que des fonctions : `public.create_campaign()` pour la première, `public.save_availability_template()` et `public.apply_availability_template()` pour la seconde. Elles ne modifient aucune donnée existante.

Celles du 19 septembre vont plus loin. `20260919120000` **modifie des données** : `RESPONSABLE` disparaît et les comptes qui le portaient passent `GESTIONNAIRE`. C’est une extension de droits — d’une seule équipe au centre entier, plus le droit d’inviter — tracée au journal d’audit. Elle ajoute `profiles.fonction` et `invitations.fonction`, et `private.can_manage()` perd sa branche par équipe : un gestionnaire gère désormais tout son centre, et le filtre par équipe n’a plus d’objet.

`20260921140000` ne change qu'une ligne de `private.publish_schedule_shift()` : le créneau est désormais lu `for update`. Sans ce verrou, deux publications simultanées lisaient la même `published_revision` et en calculaient la même ; la clé primaire de `schedule_assignments` arrêtait bien la seconde, mais par une violation de contrainte. Le verrou ne porte que sur la ligne du créneau — deux publications sur deux créneaux différents ne s'attendent pas.

`20260919200000` ajoute `public.shift_withdrawals`. Un agent ne peut s’y inscrire que pour lui-même et que sur une garde qu’il tient réellement : `private.holds_published_shift()` exige de figurer dans la révision publiée. Le décideur est estampillé par un déclencheur, jamais par le client, et la table ne touche pas au planning.

Les deux du 21 septembre portent les notifications poussées. `20260921100156` ajoute `public.push_subscriptions` et `public.push_deliveries` : la première n’accepte qu’une adresse de remise d’un service connu, la seconde est une file que **seul le serveur** peut lire — aucun droit n’est donné à une session d’agent, et le déclencheur `private.enqueue_push()` y inscrit un envoi par appareil dès qu’une notification est écrite. `20260921130000` ajoute `public.register_push_subscription()`, la seule façon pour un appareil de s’inscrire : elle lit le centre sur le rattachement actif de l’appelant plutôt que de le croire sur parole, et reprend un téléphone qui a changé de main. Depuis `20260927090000`, elle ne le reprend que s’il est réclamé — activer depuis l’écran, ou rouvrir l’application avec un compte qui avait accepté — et garde la ligne, donc les envois en attente, quand le même compte se réinscrit. La déconnexion rend l’appareil.

L'application est en ligne sur Vercel depuis le 24 septembre 2026 (`https://dispo-sp.vercel.app`, chaque commit de `main`) ; la recette hébergée de [docs/RECETTE.md](docs/RECETTE.md) n'a jamais été consignée — son journal est vide au 27 octobre —, et le porteur du projet a choisi d'ouvrir directement la première campagne réelle en novembre.

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
- **La navigation.** Deux `loading.tsx`. Celui de la racine couvre le premier chargement : la mise en page du groupe lit toute la base avant de rendre la barre latérale, et un `loading` de groupe n’enveloppe pas la mise en page qui le porte. Celui de `(workspace)` couvre les navigations suivantes, barre latérale et en-tête restant en place.

Le spinner est un SVG animé par CSS, pas une icône de la bibliothèque : `prefers-reduced-motion: reduce` arrête la rotation et le balayage de la barre, qui reste visible en opacité réduite. Une icône qui tournerait toute seule ne saurait pas s’arrêter. Il porte `aria-hidden` — c’est le texte à côté qui est annoncé.

### Application installable

`src/app/manifest.ts` décrit l'application, ses icônes et deux raccourcis ; `src/components/pwa.tsx` enregistre l'agent de service et propose l'installation ; `public/installation.js` retient la proposition de Chrome dès le chargement de la page. Les icônes servies viennent du dossier de marque, comme décrit plus haut ; iOS ignore le manifeste et prend `apple-touch-icon.png`.

**L'agent de service ne met aucune donnée en cache.** C'est une décision, pas un raccourci : une disponibilité, une affectation ou un planning servis depuis un cache seraient une information périmée présentée comme à jour, ce qui dans ce métier est pire que pas d'information du tout. Il n'existe que parce qu'un navigateur ne propose l'installation qu'à une application dotée d'un gestionnaire `fetch`, et celui-ci laisse tout passer au réseau. Une seule ressource est conservée, `/hors-ligne`, qui ne contient rien et ne peut donc pas dater. La consultation hors ligne reste une extension à cadrer. L'agent de service a désormais un second rôle, lui aussi sans cache : recevoir les notifications poussées — voir plus bas.

Sur Chrome et ses dérivés, un bouton « Installer » apparaît sur l'écran de connexion et dans la barre du haut de chaque écran, pour tous les rôles, dès que le navigateur signale que l'installation est possible ; le profil garde son panneau. **Le signal de Chrome (`beforeinstallprompt`) est retenu par `public/installation.js`, chargé avant l'hydratation par la stratégie `beforeInteractive`** : il n'était écouté que par le panneau du profil, qui le manquait quand Chrome l'émettait avant lui, et que le menu de l'encadrement n'atteint pas — le bouton n'apparaissait presque jamais. Le retenir retire à Chrome sa propre bannière : c'est l'application qui propose. `tests/e2e/installation.spec.ts` le garde, avec un événement fabriqué ; un vrai Chrome l'a vérifié le 25 septembre (`.local/audit-20260925/e2e/installable-local.cjs`, dossier non versionné). Safari ne le signale jamais : le chemin iOS — Partager, puis « Sur l'écran d'accueil » — est donc écrit en toutes lettres.

### Notifications et envoi des emails

Une notification est écrite au moment où elle est méritée : un déclencheur l'inscrit à l'ouverture d'une campagne, la fonction de publication à la publication, et `public.remind_campaign()` quand un responsable relance. L'envoi est un acte séparé, qui peut échouer.

`public.notifications` sert donc de file d'attente : `sent_at` appartient à l'expéditeur, `read_at` au destinataire. Depuis le 22 septembre, la file a le même modèle que celle des notifications poussées : un état par message (`email_status`), des tentatives, un bail de deux minutes et un délai qui double après chaque échec. **Après chaque commande, une fois la réponse partie**, `src/lib/mailer.server.ts` réserve un lot sous la clé du serveur (`public.claim_email_deliveries()`), envoie **un message à la fois** à Resend avec un délai de dix secondes, et rend chaque résultat (`public.finish_email_delivery()`). Une adresse refusée n'échoue que pour elle ; deux gestionnaires qui publient ensemble ne font plus partir chaque email deux fois ; et un agent qui se désiste est signalé sans attendre le geste d'un gestionnaire. **Sans les trois variables `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL`, aucun email n’est envoyé** : les notifications arrivent dans le centre de l'application, et la file attend. C'est la raison d'être de la file — un envoi raté ne doit pas annuler l'écriture qui l'a provoqué.

`RESEND_API_KEY` est le premier secret du projet. Jamais de préfixe `NEXT_PUBLIC_` : il partirait dans le paquet du navigateur. Lire la file suppose de lire les notifications et les adresses d'autrui, ce qu'aucune policy n'autorise et qu'aucune ne devrait : les deux fonctions de réservation ne sont exécutables que par le serveur (`service_role`), ce qui rend `SUPABASE_SECRET_KEY` nécessaire à l'envoi. `public.pending_notifications()` et `mark_notifications_sent()` subsistent — la migration `0007` vérifie leur présence — mais sont fermées aux sessions depuis `20260925180000` ; l'encadrement lit l'état des files dans Paramètres → Traitements planifiés.

L'adresse elle-même vient de `auth.users`, que PostgREST n'expose pas. `0006` en garde une copie sur `profiles`, remplie à la création du profil et tenue à jour par déclencheur : l'autorité reste au schéma d'authentification, et aucune session cliente ne peut la modifier.

Le rappel avant clôture reste d'abord un geste : le bouton du tableau de bord vise les agents qui n'ont pas validé, et la base refuse d'empiler deux rappels sur la même personne. Un centre peut aussi l'automatiser, avec le rappel de garde : voir « Rappels automatiques et traitements planifiés » plus bas. Le message d'activation d'un agent invité ne passe pas par cette file : il part de Supabase Auth (`auth.admin.inviteUserByEmail`, voir « Premier compte » et les gabarits plus bas), comme la réinitialisation d'un mot de passe.

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

### Rappels automatiques et traitements planifiés

Lot A des [évolutions opérationnelles](docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md), migration `20261020090000`. Deux messages partent sans que personne n'ouvre l'application :

- **le rappel de garde**, la veille à l'heure choisie par le centre (18 h par défaut) : « Vous êtes de garde demain, mercredi 21 octobre, de 8 h à 20 h. » Le Jour et la Nuit d'une même date font une seule garde de 24 h et un seul rappel. La veille se calcule sur la date locale du centre, ce qui tient aux changements d'heure. Une garde publiée après l'heure du rappel n'en reçoit pas, puisque l'avis de publication vient de partir. Passé minuit, un rappel manqué n'est pas rattrapé : « demain » serait faux ;
- **la relance avant clôture**, 48 h puis 24 h avant la date de clôture, aux agents inscrits qui n'ont pas validé. Elle suit la règle des 12 heures de la relance manuelle et compte pour elle. Après une interruption, seule l'échéance la plus récente part.

L'encadrement ne reçoit ni l'un ni l'autre (décision C6). Le push reste discret — « Rappel : une garde vous attend. » — et l'email donne la date et les horaires, jamais le nom d'un autre agent.

**Désactivé par défaut, centre par centre.** Paramètres → Rappels automatiques : une case et l'heure du rappel, pour un gestionnaire ou un administrateur. Le réglage entre à l'historique avec son auteur.

**Deux tâches Supabase Cron, toutes les cinq minutes.**

1. `disposp-generation` appelle `private.generate_due_notifications()`, en SQL seul, sans appel réseau ni secret. Elle crée les rappels et relances arrivés à échéance dans la file habituelle (`public.notifications`, donc emails et push). Chaque événement porte une clé unique (`event_key`) : deux passages simultanés ou rejoués ne créent jamais deux fois le même rappel. Un verrou consultatif empêche aussi deux générations en même temps.
2. `disposp-livraison` appelle `POST /api/traitements` par `pg_net`. La route, protégée par `SCHEDULED_TASKS_SECRET` (comparé en temps constant), vide les files push puis emails par lots, en quarante secondes au plus, et inscrit son passage au journal. Les files gardent leurs règles : bail, reprises espacées, suspension quand Resend refuse le compte. L'adresse de l'application et le secret sont rangés chiffrés dans Vault, jamais en clair dans la définition de la tâche.

La livraison vide la file de **tous** les centres, qu'ils aient activé les rappels ou non. Un email resté en attente après une panne de Resend repart donc au plus cinq minutes après le retour du service, sans attendre qu'un utilisateur agisse.

**Un rappel devenu faux ne part pas.** Une garde retirée, un désistement accepté, un agent désactivé, une réponse validée ou une campagne close : le rappel en attente passe à `skipped` (email) et `suppressed` (push). Le recontrôle est fait par les deux fonctions de réservation elles-mêmes, avant chaque lot. Les files se vident aussi après chaque commande et par `/api/push/dispatch` : sans ce recontrôle, accepter le désistement d'un agent aurait vidé la file juste après et lui aurait envoyé le rappel de la garde qu'il ne tient plus. Ce qui est déjà remis au fournisseur ne se rattrape pas.

**Le suivi.** Paramètres → Traitements planifiés montre à l'encadrement :

- la dernière génération et la dernière livraison réussies ;
- les passages en erreur sur 24 h ;
- les emails en attente et en échec, et les push en attente.

Les valeurs sont des dates et des nombres, jamais un destinataire ni un message d'erreur. Deux avertissements peuvent s'y afficher :

- **aucune génération depuis un quart d'heure** : les tâches ne sont pas activées sur le projet ;
- **la génération tourne mais aucune livraison ne la suit** : l'adresse ou le secret recopiés dans Vault sont faux, et la route refuse l'appel sans rien inscrire.

Le journal (`private.scheduled_runs`) garde trente jours.

**Mise en service, dans cet ordre :**

1. Appliquer la migration `20261020090000_traitements_planifies.sql`, puis déployer l'application qui la lit.
2. Sur l'hébergeur, déclarer `SCHEDULED_TASKS_SECRET` (32 caractères au moins : `openssl rand -hex 32`) et redéployer.
3. Recopier l'adresse publique et le même secret en tête de `supabase/provisioning/activer-les-traitements-planifies.sql`, puis exécuter le fichier dans l'éditeur SQL. Il active `pg_cron` et `pg_net` si besoin, range les deux valeurs dans Vault et planifie les deux tâches. Le relancer remplace l'adresse, le secret et les tâches.
4. Activer les rappels du centre depuis Paramètres, puis regarder le suivi au passage suivant.

`supabase/provisioning/desactiver-les-traitements-planifies.sql` retire les deux tâches et ne touche à rien d'autre : notifications, files, journal et réglages restent en place, et les messages en attente repartent à la prochaine commande, comme avant le lot A.

Vérifié le 20 octobre 2026 sur une pile Supabase locale (`pg_cron`, `pg_net` et Vault réels, application jointe par `host.docker.internal`) :

- à l'activation, les 14 rappels de garde attendus pour le lendemain, aucun pour l'encadrement ;
- la route jointe par `pg_net` avec le secret de Vault (200), et refusant un secret faux (401) ;
- l'annulation par le vidage qui suit une commande ;
- les deux panneaux de Paramètres, sur ordinateur et sur téléphone.

Sur le projet hébergé, le porteur du projet a exécuté le script d'activation le 21 octobre 2026 ; le premier passage réel avec des rappels n'a pas encore été observé. Il n'y a pas de second projet Supabase (décision du 20 octobre) : les vérifications se font en production, progressivement, sur des comptes d'essai du porteur du projet (préalable 0 de la spécification).

### Photographies pour le bilan

Lot A, seconde partie, migration `20261020150000`. Le bilan mensuel du lot E ne peut pas se calculer sur l'état courant : un départ, une promotion ou une qualification acquise réécriraient les mois passés. La base fige donc trois moments, selon le [contrat de photographies](docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md) de la spécification :

| Moment           | Pris                                                     | Retient                                                                                                    |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Publication      | dans la transaction de chaque nouvelle version publiée   | besoin, minima, affectés, qualifications de chacun à cet instant                                           |
| Clôture          | à la date de clôture de la campagne, pas au verrouillage | participants, attendus (membres actifs de rôle agent), validés à la clôture                                |
| Début de créneau | à l'heure de début, publié ou non                        | version en vigueur, besoin applicable, effectif encore tenu, désistements acceptés, minima couverts ou non |

Chaque photographie a deux niveaux :

- un **fait**, fait de nombres et de valeurs recopiées, sans identifiant de personne ni clé vers un compte ou une campagne ;
- des **détails**, une ligne par personne.

Le retrait d'un compte efface ses détails et garde les faits. La purge efface les détails avec les campagnes, et les faits à leur propre échéance, `duree_faits`, alignée par défaut sur celle des campagnes. Le DPO décidera s'il faut l'allonger pour le bilan : un fait sans nom reste ré-identifiable dans un petit centre ([docs/RGPD.md](docs/RGPD.md)).

**Clôture et début se prennent au passage planifié** (`private.generate_due_notifications()`, la tâche `disposp-generation`). Un passage en retard reste exact : toute modification qui pourrait changer ce qu'une photographie due doit retenir la prend d'abord, dans sa propre transaction. Cela vaut pour :

- un rattachement : rôle, activité, section ou départ ;
- un besoin ou un minimum ;
- un désistement ;
- une publication ;
- une affectation effacée.

Les scripts de retrait et de purge font de même avant d'effacer. Sans les tâches planifiées, les photographies sont donc prises plus tard, mais justes.

L'historique commence à l'application de la migration (`private.history_start`) : rien n'est reconstitué pour le passé. Aucune session n'accède à ces tables ; le lot E les exposera par des fonctions qui contrôlent les droits. `inventaire-du-centre.sql` les compte, `exporter-les-donnees-d-un-compte.sql` les rend, et `basculer-vers-un-vrai-centre.sql` efface celles du centre d'essai.

### Publier le mois

Lot B, migration `20261020200000`. Dans le planning, **Publier le mois** ouvre un aperçu calculé par la base pour la campagne affichée :

- **prêts** : nouveaux ou modifiés, et rien ne les empêche ;
- **bloqués** : avec leur date, Jour ou Nuit, et chaque motif — effectif incomplet, qualification manquante, besoins non définis, désistement accepté, agent désactivé, disponibilité qui ne correspond plus. Toucher un créneau bloqué y mène ;
- **inchangés** : déjà publiés tels quels.

Le bouton dit exactement ce qu'il fera, par exemple « Publier les 48 créneaux prêts ».

**Une seule définition d'un créneau publiable.** `private.shift_blockers()` rend les motifs, dans l'ordre où la publication les vérifie. La publication unitaire lève le premier, avec le même message qu'avant ; l'aperçu les montre tous. Les deux ne peuvent pas se contredire.

**Une transaction, ou rien.** `public.publish_month()` :

1. verrouille les créneaux du mois dans l'ordre de leur identifiant ;
2. recalcule l'aperçu sous ce verrou, et refuse si son empreinte n'est plus celle que le gestionnaire a vue — l'écran relit alors l'aperçu ;
3. publie chaque créneau prêt par le même chemin que la publication unitaire, photographies du lot A comprises.

Une erreur sur un créneau annule toute l'opération. Un créneau bloqué garde sa version publiée : un brouillon incomplet n'efface rien.

**Une demande, une publication.** L'écran tire un identifiant de demande à chaque aperçu. Un double clic ou une reprise réseau renvoient la même demande, et la base rend le premier résultat sans rien republier (`private.month_publications`).

**Un avis par agent dont les gardes changent**, et aucun par créneau en plus. Il dit ses gardes ajoutées et retirées, avec dates et horaires — une garde de Jour et de Nuit le même jour devient « de 8 h à 8 h le lendemain (24 h) » —, jamais le nom d'un autre agent. Un agent retiré de toutes ses gardes est prévenu ; un agent sans changement ne reçoit rien ; un agent retiré après un désistement accepté non plus, comme pour la publication unitaire. Le push reste « Votre planning a été publié ou modifié. ». L'opération entre à l'historique, en plus de la ligne de chaque créneau.

L'aperçu se lit par `GET /api/planning/mois?campagne=…`, sous la session du gestionnaire : une lecture, demandée à l'ouverture de la fenêtre. La publication passe, comme toute écriture, par l'action serveur.

### Repos et appels à remplacement

Lot C, migration `20261021090000`, complétée par `20261027090000` (verrou par agent).

**La règle de repos du centre (décision du 21 octobre).** Après une garde, l'agent a autant de repos qu'elle a duré : 12 h après une garde de 12 h, 24 h après le Jour et la Nuit d'une même date. Un chevauchement d'horaires est refusé a fortiori. La base l'applique :

- à chaque publication, unitaire ou du mois, contre les gardes publiées de l'agent dans toutes les campagnes ;
- pour la publication du mois, contre les autres créneaux qu'elle publie avec lui. L'aperçu ne retient qu'un ensemble de créneaux prêts compatibles entre eux, et la publication juge chacun avec ce même ensemble ;
- à chaque candidature à un appel.

Le motif nomme l'agent et la garde en cause (« Repos insuffisant : Léa Martin (garde du 03/11, Nuit) »). **Changement de comportement** : une Nuit suivie du Jour du lendemain, acceptée jusqu'ici, est désormais refusée à la publication. Le 24 h reste possible.

**Deux publications en même temps (migration `20261027090000`).** La base verrouille chaque agent affecté le temps de la publication — d'un créneau, du mois — et chaque candidat le temps de sa proposition, toujours dans le même ordre. Deux publications de deux créneaux différents qui engagent le même agent se font donc l'une après l'autre, et la seconde juge son repos contre ce que la première a validé. Sans ce verrou, la Nuit du 31 dans une campagne et le Jour du 1er dans la suivante pouvaient être publiés à la même seconde par deux personnes, tous deux acceptés.

**Les appels.** Deux entrées :

- **« Accepter et chercher un remplaçant »**, sur un désistement en attente. La base accepte le désistement — l'agent est prévenu —, le retire du brouillon (il reste au planning publié jusqu'à la republication) et ouvre l'appel, dans une seule transaction ;
- **« Chercher du renfort »**, au planning, sur une garde dont le brouillon ne couvre pas le besoin.

Avant de lancer, un aperçu (`GET /api/appels/apercu`) donne le besoin restant — places et qualifications manquantes, calculées sur l'équipe conservée — et le nombre d'agents sollicités.

L'appel vise les agents actifs de l'équipe de la campagne, utiles au besoin, sans conflit de repos, et dont la disponibilité validée couvre la garde. L'agent qui se désiste n'est jamais sollicité. Le gestionnaire peut l'**élargir** aux autres agents de l'équipe ; ceux-là ne se proposent qu'en **déclarant leur disponibilité** pour cette garde.

La déclaration est une preuve gardée : horaires acceptés, date, version du texte affiché. Elle ne touche ni à la campagne ni à la réponse validée de l'agent. Un appel par garde à la fois ; il expire au début de la garde.

**L'agent** reçoit un avis (application, email avec date et horaires, push discret « Une garde est à pourvoir. »). Dans **Appels**, il se propose ; cela ne l'affecte à rien — ni planning, ni agenda, ni rappel. Il peut retirer sa proposition tant qu'elle n'est pas publiée. Ni le motif du désistement ni le nom du remplacé ne lui sont montrés.

**Le gestionnaire** suit l'appel au planning, sur la garde concernée : propositions, qualifications utiles, charge du mois, heure de proposition. Il **retient** des candidats dans le brouillon ; la base recontrôle à chaque geste la disponibilité ou la déclaration, le repos et le besoin restant, sous le verrou de la garde, ce qui interdit le surnombre. Plusieurs candidats peuvent se compléter. **« Confirmer et publier »** publie la garde par le chemin habituel.

**Toute publication qui couvre la garde ferme l'appel**, qu'elle vienne de l'appel ou du planning. Les retenus sont confirmés ; les autres candidats apprennent que la recherche est terminée, sans plus de détail ; les sollicitations encore en file ne partent plus. Annulé ou expiré, l'appel ne compte pas comme un remplacement.

**La preuve d'une déclaration** vaut pour une republication inchangée, même l'appel fermé. Elle cesse quand l'agent sort du planning : une réaffectation future exigera une nouvelle déclaration.

### Agenda abonné

Lot D, migration `20261021150000`. Dans **Mon planning**, l'agent crée une adresse privée et l'ajoute une fois à son logiciel d'agenda. L'export ponctuel reste.

- **Apple Calendrier** : le lien `webcal:` ouvre l'abonnement directement.
- **Google Agenda** : sur ordinateur, Autres agendas, « À partir de l'URL ».
- **Outlook** : « S'abonner à partir du web ».

**Le contenu.** Le flux contient les gardes publiées encore tenues de l'agent, sur trois mois en arrière et douze en avant (valeurs de départ du §2). Il n'y a ni brouillon, ni proposition, ni garde dont un désistement accepté l'a relevé.

Chaque garde garde l'identifiant de l'export ponctuel, et la révision publiée lui sert de séquence : une republication modifie l'événement au lieu d'en créer un second. Les horaires sont en UTC, calculés sur ceux de la campagne et le fuseau du centre.

**Une garde retirée disparaît du flux.** Un abonnement se relit en entier à chaque synchronisation, et Apple comme Google retirent alors l'événement d'eux-mêmes ; aucun événement « annulé » n'est gardé. Il n'y a pas d'alarme : le rappel de garde est celui de DispoSP.

**Le rythme est celui du logiciel d'agenda** : le flux suggère une heure (`REFRESH-INTERVAL`), Google relit souvent moins vite. L'écran le dit, et rappelle que les modifications urgentes arrivent par les notifications de DispoSP.

**La sécurité.**

- **Le jeton** : 32 octets tirés par le serveur (`POST /api/agenda`), rendus une seule fois. La base n'en garde que le condensat SHA-256 : personne, pas même l'encadrement, ne peut relire l'adresse.
- **Le flux** (`GET /api/agenda/<jeton>.ics`) se lit sans cookie. Le middleware ne laisse passer que cette forme exacte, sans appeler le service de connexion.
- **La route** réduit le jeton à son condensat avant toute requête, et ne le journalise jamais.
- **La base vérifie à chaque lecture** que l'abonnement est actif et que l'agent est toujours membre actif qui prend des gardes : une désactivation, un passage à l'encadrement ou une révocation coupent l'accès. Un jeton inconnu, révoqué ou d'un agent écarté reçoit le même 404.
- **La réponse** porte `Cache-Control: private, no-store`.
- **Une nouvelle adresse révoque l'ancienne.** « Révoquer » coupe tout.

À savoir : l'hébergeur journalise les adresses demandées ; le jeton y figure, comme dans toute adresse d'abonnement. L'accès à ces journaux doit rester restreint.

### Configuration

Définir les deux variables suivantes dans `.env` en local et dans la configuration de l’hébergeur pour le site déployé :

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=votre-cle-publiable
```

**Il n'existe pas de mode de repli.** Sans ces valeurs l'application s'arrête, et c'est délibéré : un déploiement mal configuré doit se voir. Le mode démonstration, qui affichait douze agents fictifs conservés dans le navigateur, a été retiré — un site en production ne peut donc plus montrer silencieusement de fausses données à la place des vraies.

Les variables `NEXT_PUBLIC_*` sont intégrées au moment de la construction : après modification, reconstruire puis redémarrer ou redéployer l’application. Pour les emails métier, ajouter côté serveur `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL` ; ne jamais préfixer la clé Resend par `NEXT_PUBLIC_`. Pour les notifications poussées, ajouter `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` et `WEB_PUSH_SUBJECT` — la clé publique **doit** porter le préfixe, la privée jamais. Pour les rappels automatiques, ajouter `SCHEDULED_TASKS_SECRET`, la même valeur que celle recopiée dans Vault. `.env.example` décrit chaque variable et sa raison d'être.

`src/lib/data.server.ts` construit depuis la base exactement la forme que les écrans consomment déjà : aucun écran n'a eu à changer. Le mapping vit à part dans `src/lib/data-mapping.ts`, pur et testé seul, parce que c'est là que se logent les erreurs — fuseau de la fenêtre de réponse, séparation brouillon/publication, révisions périmées, lignes hors de portée RLS.

Les commandes métier passent par une action serveur unique, `submitCommand`. C'est un point d'entrée public : sa charge utile est parsée par Zod et l'identité vient du cookie de session, jamais de ce que le navigateur annonce. Un refus de la base est traduit en français par `src/lib/command-errors.ts` ; un message inconnu n'est jamais affiché tel quel, puisqu'il décrirait le schéma. Aucune écriture refusée n'est renvoyée en silence vers `localStorage`, ce qui donnerait l'illusion d'un enregistrement.

La création d’une campagne passe désormais par `public.create_campaign()` : campagne, planning, créneaux Jour/Nuit, participants actifs et notifications sont créés dans une transaction unique. Une erreur annule aussi les écritures d’audit. La fonction utilise les droits de l’appelant (`security invoker`) et conserve les contrôles RLS ; les horaires proviennent du centre et la clôture correspond à 23 h 59 min 59 s dans le fuseau du centre (Europe/Paris par défaut). L’envoi des emails intervient seulement après le succès de la transaction. **L'écran Campagnes exige que la clôture des réponses précède le mois de la campagne** : une campagne de décembre se crée en novembre, et une campagne de novembre au plus tard le 31 octobre. Pour une campagne du mois déjà commencé — le cas d'un centre qui démarre en cours de mois —, voir le script de « Premier compte ».

En mode connecté, le proxy (`src/proxy.ts`, ce que Next 16 appelait middleware ; la logique est dans `src/lib/supabase/middleware.ts`) renouvelle la session à chaque requête et renvoie tout visiteur sans session vers `/connexion`. `getUser()` y est utilisé plutôt que `getSession()` : le second se contenterait d'un cookie que le navigateur pourrait forger.

### Premier compte

1. Créer le compte depuis `/connexion` et **confirmer l'adresse** reçue par email.
2. Adapter les quatre valeurs en tête de `supabase/provisioning/premiere-organisation.sql`, puis exécuter le fichier dans l'éditeur SQL du tableau de bord.
3. Adapter le nom du centre et de l'équipe dans `supabase/provisioning/premiere-campagne.sql`, puis l'exécuter : il ouvre la campagne du mois qui suit la date d'exécution (`month_offset`, 1 par défaut), avec des réponses closes à la fin du mois en cours, inscrit les agents actifs de l'équipe (pas l'encadrement) et prépare les créneaux Jour et Nuit du mois. Lancé le 27 octobre, il ouvre novembre et ferme les réponses le 31 octobre à minuit ; lancé le 2 novembre, il ouvre décembre. Pour une campagne du mois en cours, mettre `month_offset` à 0 : les réponses restent ouvertes jusqu'à la fin de ce mois, ce que l'écran Campagnes, lui, n'accepte pas — c'est le seul chemin pour un centre qui démarre en cours de mois. Sans campagne, l'application affiche un écran l'expliquant, puisque tous les écrans en dépendent.

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
TZ=UTC pnpm vitest run --exclude tests/database.test.ts
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Ces sept vérifications sont celles exécutées par l'intégration continue (sous PowerShell, `$env:TZ = "UTC"` avant la cinquième).

**L'intégration continue ne fournit délibérément aucun projet Supabase**, et cela impose deux choses qu'il est facile de reperdre :

- **Aucun écran de l'espace de travail ne doit être prérendu.** Next l'apprenait par `cookies()`, que le client Supabase finit par appeler — mais sans coordonnées il n'y arrive jamais, `credentials()` levant avant. Le prérendu les prenait donc pour des pages statiques et le build s'arrêtait sur la première : « Error occurred prerendering page "/accueil" ». `readSession()` ouvre maintenant par `await connection()`, qui le dit sans rien supposer de la configuration. `export const dynamic` ferait la même chose, mais la v16 l'a retiré de la configuration de segment.
- **Le sondage de démarrage de Playwright vise `/connexion`, pas la racine.** La racine n'est pas un chemin public : sans coordonnées, le garde y lève et rend une 500, que Playwright ne tient pas pour un serveur prêt. Il attendait ses soixante secondes puis renonçait — sur l'environnement même que ces parcours doivent couvrir.
- **Une page publique ne précharge pas un écran de travail.** Next précharge en production tout lien visible, et ne lit pas le corps d'une réponse qui n'est pas la sienne — l'erreur de la racine sans coordonnées, ou la page de connexion vers laquelle le garde redirige avec elles. Le navigateur tient alors la requête pour ouverte, et la page n'est jamais « chargée » : le test de politique de contenu de `/hors-ligne`, qui attend ce moment, a laissé l'intégration continue rouge du 23 au 25 septembre. Les liens de `/hors-ligne` et de la page introuvable portent donc `prefetch={false}`.

**Une intégration continue rouge ne bloque aucun déploiement** tant que l'hébergeur ne l'attend pas : Vercel construit et publie chaque commit de `main`, qu'elle ait réussi ou non — c'est ainsi que neuf exécutions rouges sont passées en production, et c'est encore le cas le 27 octobre 2026 (déploiement publié à 9 h 28 UTC, CI verte à 9 h 31). Pour qu'un échec arrête la mise en ligne, activer dans le projet Vercel **Settings → Deployment Checks** avec la vérification GitHub « verify » du workflow CI : le déploiement se construit, mais n'est promu en production qu'une fois la CI verte.

La suite navigateur compte 44 parcours dans 12 fichiers, joués chacun sur ordinateur et sur un iPhone 13 simulé (104 tests). Sans projet Supabase — le cas de l'intégration continue —, les parcours qui demandent une session se sautent d'eux-mêmes et seule la surface publique s'exécute. Avec `.env` et un compte d'essai rattaché au centre, ils se jouent contre le projet que `.env` désigne : depuis que ce projet porte le centre réel, ne les lancer qu'en sachant ce qu'ils y font.

**La suite navigateur a fondu avec le mode démonstration**, et il faut le dire franchement : les trente parcours d'interface qu'elle jouait — saisie, validation, affectation, publication, exports — pilotaient douze agents fictifs qui n'existent plus. Ils n'ont pas été remplacés par des tests automatiques ; ils sont devenus les étapes manuelles de [la recette](docs/RECETTE.md). Ce qui reste automatique et sans données : le manifeste, les icônes, l'agent de service et l'adaptation aux écrans.

Les parcours de `tests/e2e/connexion.spec.ts` demandent un projet Supabase joignable et se sautent sans `NEXT_PUBLIC_SUPABASE_URL` — ce qui est le cas de l'intégration continue, qui n'en fournit aucun et vérifie ainsi que la surface publique se sert sans base.

En local, rien à exporter : la configuration Playwright charge `.env` comme Next le fait pour le serveur. Sans cela les deux divergeaient, et des parcours se sautaient en croyant le serveur non configuré alors qu'il l'était — « douze tests ignorés » qui ne voulaient plus rien dire.

Deux des quatre parcours de `pwa.spec.ts` demandent une session et attendent `E2E_EMAIL` et `E2E_PASSWORD`, un compte d'essai rattaché à un centre. Sans eux ils se sautent, au lieu d'échouer sur un écran de connexion. Celui des notifications poussées demande en plus la clé publique VAPID : un navigateur piloté refuse toute autorisation de notification, le parcours vérifie donc que l'écran ne prétend jamais qu'elles sont actives et qu'il donne toujours la suite — activer, ou rouvrir ce que le navigateur a fermé.

Les règles métier, elles, n'ont rien perdu : elles sont vérifiées contre un vrai PostgreSQL par les 298 tests de `tests/database.test.ts`, migrations et politiques comprises — 608 tests dans 27 fichiers au 27 octobre 2026, rejoués en UTC hors base. Le suivi des vérifications et des correctifs figure dans [la dernière analyse](docs/ANALYSE_PROJET_2026-10-27.md).

Dans un environnement Windows où `pnpm exec` ne résout pas les exécutables, utiliser `node node_modules/@playwright/test/cli.js install chromium`, puis `node node_modules/@playwright/test/cli.js test`.

Pour placer les navigateurs de test dans le projet sous PowerShell :

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
node node_modules/@playwright/test/cli.js install chromium
node node_modules/@playwright/test/cli.js test
```

Les tests couvrent notamment les validations explicites, la clôture, les disponibilités 24 h, les publications, les exports, l'isolation des organisations en PostgreSQL, la publication contrôlée en base, la résistance à une sauvegarde locale inutilisable, la virtualisation de la synthèse et les parcours utilisateur sur ordinateur et mobile. Pour les notifications poussées : la liste des services de remise acceptés, le contenu envoyé — qui ne doit nommer personne —, l'isolation des abonnements entre agents, la reprise d'un appareil qui change de main, la file d'envoi hors de portée d'une session et l'effacement d'un appareil que le service de remise ne connaît plus. Six d'entre eux gardent l'adaptation aux écrans, décrite plus bas.

### Adaptation aux écrans

Une seule rupture sépare le téléphone de l'ordinateur, à 760 px : en dessous, la barre latérale devient un tiroir et une barre de navigation s'installe en bas. Trois ruptures de confort l'accompagnent — 1200, 1000 et 560 px — et une quatrième, à 1700, élargit la mise en page sur les très grands écrans ; deux retouches locales, à 900 px (le panneau de marque de l'écran de connexion disparaît) et 420 px (le bouton « Installer » de la barre du haut se réduit à son icône), n'en sont pas.

`tests/e2e/responsive.spec.ts` en garde six règles. Deux s'exécutent toujours, sur `/connexion` et `/hors-ligne` : aucune page ne dépasse la largeur de l'appareil, aucune commande ne descend sous 24 px de côté. Les autres demandent `E2E_EMAIL` et `E2E_PASSWORD` et parcourent alors quinze des seize écrans de travail — « Appels » n'y est pas encore —, où se trouvent les tableaux, les filtres et les modales : la partie où l'adaptation se joue vraiment. L'une d'elles mesure une chose qu'aucun débordement ne signale : **un sélecteur trop étroit pour l'option qu'il affiche**. Il ne déborde de rien, il ne coupe aucun texte au sens du navigateur, il affiche simplement « Tout… » et ne dit plus ce qu'il filtre.

Trois défauts corrigés en septembre 2026 valent d'être notés, parce qu'ils reviendront sous la même forme :

- **Une cible de 24 px doit être imposée, jamais espérée.** Une case à cocher de navigateur fait 13 px, un « × » de texte en fait 11. Trois endroits l'avaient oublié — les qualifications d'une fiche agent, les cases des fiches, la croix du bandeau de message.
- **`max-width` en pourcentage sur un élément flexible est un piège sur téléphone.** Les filtres portaient `max-width: 48 %`, ce qui les réduisait à 64 px sur un écran de 320 et à 27 px sur l'historique, où le filtre de période dispute la même rangée. Une base en pixels (`flex: 1 1 145px`) laisse l'élément passer à la ligne plutôt que rétrécir sous le lisible.
- **Un côte à côte qui tient à 600 px ne tient pas à 320.** L'anneau des statistiques laissait 75 px à son texte, un mot par ligne. Il s'empile sous 560 px, et garde la disposition de la maquette au-dessus.

Deux autres sont venus d'une relecture, et ils disent surtout ce qu'une mesure du débordement **horizontal de la page** ne peut pas voir :

- **La hauteur.** Le menu mesure près de 870 px et il est en `position: fixed` : ce qui dépasse le bas de l'écran ne fait déborder aucune page, il sort simplement du cadre. Sans `overflow-y` sur la barre, huit rubriques devenaient inatteignables à 844 × 390 — un portable posé en paysage — et « Paramètres » dès 1024 × 768.
- **L'intérieur d'un conteneur borné.** Une boîte de dialogue masque ce qui la dépasse : la page ne déborde de rien, et le champ est pourtant coupé. « Clôture des réponses » sortait de 47 px à 320 px, parce qu'un champ `month` réclame 173 px avant de pouvoir s'afficher et qu'un élément de grille ne se comprime jamais sous sa largeur intrinsèque. Les grilles de formulaire s'empilent donc sur téléphone.

Les deux règles correspondantes mesurent, l'une la position des liens du menu après l'avoir poussé jusqu'au bout, l'autre le `scrollWidth` de la boîte de dialogue elle-même. Chacune a été vérifiée en retirant son correctif : sans eux, six rubriques hors d'atteinte et 49 px de débordement.

## Limites et prochaines étapes

Les quarante migrations sont appliquées sur le projet hébergé (la dernière sur la parole du porteur du projet, les autres vérifiées en lecture seule le 27 octobre 2026) et l’application lit et écrit les données en mode connecté. Ce qui reste avant d'inviter les agents du centre réel est ordonné dans [la dernière analyse](docs/ANALYSE_PROJET_2026-10-27.md) ; la vérification pas à pas, non consignée à ce jour, est dans [la recette](docs/RECETTE.md). En résumé, au 27 octobre :

- Déployer la mise à jour de Next (16.4.3) et de zod (4.6.7), portée dans le dépôt le 27 octobre au soir : des avis de sécurité visaient la 16.3.5, dont un déni de service par les actions serveur, joignable sans compte. `pnpm audit --prod` ne rend plus que deux avis d'outillage (`source-map-js` par PostCSS, `uuid` par ExcelJS), hors de portée d'un visiteur. La mise à jour atteint le site au déploiement qui suit son commit.
- Corriger la couverture calculée par l'écran, qui ignore les déclarations exceptionnelles retenues : « Confirmer et publier » reste grisé sur un remplaçant venu d'un appel élargi, alors que la base publierait.
- Choisir la première campagne (voir « Premier compte » : le script règle le mois et la clôture), activer les Deployment Checks de Vercel, remettre aux agents la notice d'information de [docs/RGPD.md](docs/RGPD.md), puis observer en vrai la réception des emails, des notifications poussées et l'abonnement d'un agenda.
- Le lot E (bilan mensuel) n'est pas développé ; ses photographies se prennent déjà.

Les deux files d'envoi — emails et notifications poussées — se vident après chaque commande, par lots successifs tant que la base en rend un plein. Entre deux commandes, seule la livraison planifiée du lot A les vide, une fois `activer-les-traitements-planifies.sql` exécuté — fait sur le projet hébergé le 21 octobre 2026, selon le porteur du projet. Les clés VAPID sont déclarées sur l'hébergeur (vu le 27 octobre) ; la réception sur un vrai téléphone reste à observer.

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

Les désistements sont implémentés ; les **échanges nommés** entre agents — « je te donne ma garde, tu prends la mienne » — ne le sont pas : un agent signale qu’il ne peut plus tenir une garde, l’encadrement réaffecte — au planning, ou par un appel à remplacement.

Le retrait d'un compte et de ses données se fait par `supabase/provisioning/retirer-un-compte.sql`, dans l'éditeur SQL du tableau de bord. Il efface dans l'ordre des dépendances, refuse de laisser un centre sans administrateur actif, et garde les lignes du journal d'audit en retirant les coordonnées qu'elles avaient recopiées ; c'est la suppression du compte lui-même, à la main, qui en anonymise l'auteur.

Les autres procédures liées aux données personnelles — export des données d'un compte, purge des données arrivées au terme de leur durée de conservation — et ce qu'il reste à valider avec le DPO sont dans [docs/RGPD.md](docs/RGPD.md).

### Quitter le centre d'essai

**Le nom d'un centre n'est modifiable par aucune session** : les migrations `0003` et `20261020090000` ne donnent au client le droit d'écrire que les horaires et le réglage des rappels. Passer d'un centre d'essai à un vrai centre est donc une opération d'éditeur SQL, en trois temps :

1. `supabase/provisioning/inventaire-du-centre.sql` — ne modifie rien. Il compte ce que le centre d'essai contient, table par table, et liste qui y est rattaché. On regarde ce qu'on s'apprête à perdre avant de le perdre.
2. `supabase/provisioning/basculer-vers-un-vrai-centre.sql` — crée le vrai centre avec sa section, ses horaires et son catalogue de qualifications, y rattache les comptes que vous nommez, puis **efface le centre d'essai et tout ce qu'il contient**. Irréversible, et atomique : une erreur annule la création comme l'effacement.
3. `supabase/provisioning/premiere-campagne.sql` — ouvre la première campagne du nouveau centre. Sans campagne, tous les écrans affichent celui qui l'explique.

Trois points à connaître avant de lancer le second.

**Les horaires du centre d'essai sont repris.** S'ils avaient été réglés pour de bon, les recréer à 8 h et 20 h serait une régression que personne ne remarquerait avant la première campagne.

**Les comptes d'authentification ne sont jamais supprimés.** Ceux qui ne sont pas repris restent, sans rattachement : ils peuvent se connecter, et l'application leur dit qu'ils n'appartiennent à aucun centre. `retirer-un-compte.sql` puis Authentication → Users les font disparaître pour de bon. **Le compte de recette (`E2E_EMAIL`) doit figurer parmi les comptes repris**, sans quoi les parcours navigateur qui demandent une session se sauteront.

**L'effacement suit l'ordre des dépendances, et il est vérifié — pour le socle.** Les clés étrangères des tables d'origine sont en `on delete restrict` : une table oubliée fait échouer la transaction entière. Les tables venues ensuite — files d'envoi, réservations, rappels, appels, abonnements d'agenda, photographies, publications du mois — suivent leur parent en cascade (dix-sept clés `on delete cascade`), et le script compte sur elle. `tests/provisioning.test.ts` exécute **le fichier lui-même** contre un centre peuplé — campagne close et verrouillée, planning publié, désistement, appareil abonné, journal d'audit — et vérifie qu'il ne reste rien ; il ne peuple pas encore les appels ni un abonnement d'agenda, pour lesquels « il ne reste rien » tient à la cascade et non à une preuve. Il vérifie aussi que le garde des disponibilités, mis en sommeil le temps de l'effacement (il refuse toute écriture sur une campagne close, y compris un effacement), est bien rendu ensuite.

## Références de mise en œuvre

- [Installation Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [Authentification Supabase côté serveur](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Sécurisation de l'API Supabase](https://supabase.com/docs/guides/api/securing-your-api)
- [Changelog Supabase](https://supabase.com/changelog)
- [Applications web progressives avec Next.js](https://nextjs.org/docs/app/guides/progressive-web-apps) — manifeste, agent de service et notifications poussées
- [Protocole Web Push et clés VAPID](https://developer.mozilla.org/fr/docs/Web/API/Push_API)
