# Analyse du projet DispoSP — 5 octobre 2026

Version examinée : commit **6e375a9** sur **main** (« Réabonnement, Téléphone partagé », 27 septembre), avec trois documents modifiés et non commités (README, bilan du 27 septembre, contrôle des correctifs). Aucun fichier de code n'a changé depuis ce commit. La migration `20260927090000_correctifs_bilan.sql` est appliquée au projet hébergé selon le porteur du projet (1er octobre) ; la base hébergée n'a pas été contrôlée directement. Cette analyse prend la suite de [celle du 25 septembre](ANALYSE_PROJET_2026-09-25.md) et du [bilan du 27 septembre](BILAN_AVANT_DEPLOIEMENT_2026-09-27.md).

**En une phrase :** toutes les fonctionnalités de la recette, parties 1 à 7, marchent de bout en bout sur une vraie pile Supabase. Cela couvre invitation et activation, campagne, saisie et validation, besoins, publication, désistement, relance, clôture, exports et droits, et aucune règle métier ne cède. Mais deux points sont à régler avant la mise en service : **un gestionnaire peut rendre ses droits à un administrateur écarté**, et **l'intégration continue est rouge sur `main` depuis le 27 septembre**. Six défauts importants faussent par ailleurs ce que voient un agent ou l'encadrement. Le plus sérieux : un agent réaffecté après un désistement accepté se croit encore délié de la garde.

## Suivi des correctifs — 5 octobre 2026, le soir

Ce suivi prévaut sur les états des chapitres 2 et 3, conservés tels quels comme constat initial.

| Point | Correctif                                                                                                                                                                                                                                                                                                                                                                                                           | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | Mise en forme commitée par le porteur du projet (`eac3e4f`).                                                                                                                                                                                                                                                                                                                                                        | CI verte sur ce commit (run 37335568991), pour la première fois depuis le 25 septembre. **Reste à faire :** l'attente de la CI dans Vercel.                                                                                                                                                                                                                                                                                                                    |
| B2    | Migration `20261005090000_reactivation_admin_deverrouillage.sql` : `check_membership_change()` refuse tout passage à administrateur actif — par réactivation comme par nomination — qui ne vient pas d'un administrateur. L'écran « Agents désactivés » ne propose plus « Réactiver » sur un administrateur à qui ne l'est pas (« Seul un administrateur peut le réactiver. »), et le refus de la base est traduit. | `database.test.ts` : refus au gestionnaire par la fiche et par une mise à jour directe ; réactivation par un administrateur ; un gestionnaire réactive toujours un agent et corrige la fiche d'un administrateur désactivé sans le réactiver ; réinvitation d'un administrateur désactivé par un administrateur. `command-errors.test.ts` : traduction. Rendu de l'écran : `.local/audit-20261005/ecrans/correctifs.test.ts`, qui échoue sans la modification. |
| C4    | Même migration : un déclencheur sur `availability_campaigns` inscrit au déverrouillage, avant la clôture, les membres actifs de l'équipe absents de la campagne ; l'avis d'ouverture part pour eux seuls. La migration rattrape ceux qui sont déjà arrivés pendant un verrou levé depuis.                                                                                                                           | `database.test.ts` : l'arrivant est inscrit, prévenu une fois, et peut répondre ; les inscrits ne sont pas réécrits ; reverrouiller puis déverrouiller n'écrit rien ; clôture passée, membre désactivé et autre équipe écartés ; rattrapage à l'application ; gardes d'application.                                                                                                                                                                            |

| C1 | Une seule règle pour dire qu'une garde publiée n'est plus celle de l'agent : `relieves()` (`domain.ts`), la décision postérieure à la version publiée, dont `relievedFrom()` découle. **Mon planning** : l'historique la suit ; une garde à venir dont le désistement a été dépassé par une réaffectation republiée affiche « Réaffecté après votre désistement » et de nouveau « Je ne peux plus ». **Demandes** : plus de rappel de remplacement après une réaffectation voulue, mais « Réaffecté depuis : la version N… ». **Planning** : un agent revenu au vivier porte « Désistement accepté sur cette garde ». **Statistiques** : les gardes tenues se comptent par `shiftsHeld()`, sur la version publiée. `withdrawnFrom()` ne sert plus qu'au brouillon. | `domain.test.ts` : la règle lue sur une demande, la dernière demande retenue, les gardes tenues (délié sans republication, puis réaffecté). Rendu des écrans : `.local/audit-20261005/ecrans/correctifs-desistements.test.ts` (Mon planning, Demandes réaffectée et non remplacée, vivier du Planning). |
| C5 | `latestWithdrawal()` retient la demande la plus récente, et non la première trouvée. Après un refus, Mon planning garde la mention « Désistement refusé » et offre de nouveau « Je ne peux plus » ; une nouvelle demande s'affiche en attente. | `domain.test.ts` : refusée, puis nouvelle, puis retirée. Rendu : même fichier, refus puis nouvelle demande. |
| C2 | La grille de couverture du tableau de bord a autant de colonnes que le mois a de jours : `dashboard.tsx` pose `--days`, et `.heatmap` en tire `repeat(var(--days, 31), …)`. La politique de sécurité autorise déjà ces styles en ligne (`style-src 'unsafe-inline'`), comme pour l'anneau de progression. | Mesuré dans Chromium : `.local/audit-20261005/ecrans/grille-navigateur.test.ts` rend le vrai tableau de bord avec la feuille de style construite par `next build`. Octobre (31 jours) et novembre (30) alignés à 0 px, étiquettes « Jour » et « Nuit » en première colonne ; avec l'ancienne règle, novembre glisse de nouveau. Pas de test dans le dépôt : le rendu d'un écran y demande une session. |
| C3 | Migration `20261005120000_suspension_file_email.sql` : `release_email_delivery()`, réservée au serveur, rend un message réservé sans compter la tentative, après un délai ; avec une clé neuve si Resend l'a refusé, la sienne s'il n'a pas été tenté ; en échec seulement au-delà de trois jours. `mailer.server.ts` reconnaît les refus qui visent le compte, d'après les erreurs documentées par Resend : tout 401 et 403 (clé absente, restreinte ou suspendue, domaine non vérifié, mode d'essai), un 422 qui parle de `from`, les 429 de quota ; il suspend alors le passage, rend tout le lot et écrit une seule ligne au journal. Quinze minutes de délai, une heure pour un quota, une minute pour un débit trop rapide. Les refus propres à un destinataire restent définitifs. La recette (2.2) le dit. | `mailer.test.ts` : chacun des sept refus suspend après un seul essai et rend le lot avec le bon délai ; un `to` invalide reste définitif et le lot continue ; les messages déjà partis restent partis ; une suspension non enregistrée le dit. `database.test.ts` : tentative non comptée, clé neuve ou gardée, jamais abandonné pour des suspensions répétées, échec au-delà de trois jours, mauvais jeton sans effet, droits, gardes d'application. De bout en bout, vrai serveur d'envoi et vraie base : `.local/audit-20261005/serveur/correctif-c3.test.ts` — 403, 401 ou quota : trois commandes, trois appels à Resend, 25 messages en attente ; compte corrigé, les 25 partent. |

**Contre-épreuve :** les trois tests de `.local/audit-20261005/sql/constats.test.ts` qui constataient B2 et C4 échouent désormais ; les cinq autres, qui portent sur des points mineurs non traités, constatent toujours leur défaut. De même, les quatre tests de `.local/audit-20261005/ecrans/desistements.test.ts` qui constataient C1 et C5, et les trois de `.local/audit-20261005/serveur/envois.test.ts` qui constataient C3, échouent désormais.

**Vérifications après correction :** formatage, lint, types, 467 tests en Europe/Paris et 248 en UTC, construction.

**Ordre de déploiement :** `20261005120000` est la seule de ces migrations dont le code dépend. Elle s'applique après `20261005090000`, et avant le déploiement du commit qui porte C3. Sans elle, le serveur ne pourrait pas suspendre la file : il lèverait « Suspension non enregistrée » au premier refus du compte, et les messages réservés reviendraient en file deux minutes plus tard, à l'expiration du bail, en consommant une tentative.

**Non rejoué :** le navigateur sur la pile locale (Docker arrêté entre-temps). La migration n'est pas appliquée au projet hébergé ; aucun code n'en dépend, elle peut l'être avant ou après le déploiement.

## Périmètre et niveau de preuve

Trois sources de preuve, toutes rejouables depuis `.local/audit-20261005/` (dossier ignoré par git) :

- **Une recette fonctionnelle dans un vrai navigateur.** Elle tourne sur une pile Supabase locale complète : PostgreSQL 17 de Supabase avec ses rôles et privilèges par défaut, GoTrue, PostgREST et une boîte de réception locale. Les 28 migrations sont appliquées par la CLI Supabase, et le centre est provisionné par `premiere-organisation.sql` puis `premiere-campagne.sql`. L'application est construite par `next build` et servie par `next start`.
  - Les parties 1 à 7 de [la recette](RECETTE.md) y sont jouées dans Chromium, en français, à l'heure de Paris : invitations, emails d'activation, mots de passe, quatre agents, deux campagnes, un mois de disponibilités, besoins, publications, désistement, relance, clôture, exports et droits.
  - **30 étapes, toutes réussies**, plus deux défauts constatés en route. Détail : `fonctionnel/resultats.txt`.
  - Resend était désactivé. Les emails de l'application sont vérifiés dans leur file, ceux de l'authentification dans la boîte locale.
- **Trois relectures indépendantes** : base de données, serveur, écrans. Chaque défaut y est reproduit par un test qui réussit en le constatant : `sql/` (18 tests), `serveur/` (21), `ecrans/` (25). Je les ai relancées et j'ai relu chaque constat repris ici dans le code en vigueur.
- **Les six contrôles de l'intégration continue** sur la copie de travail, puis les parcours e2e du dépôt avec le compte de recette.

**Non vérifié :** la réception réelle d'un email Resend, une notification poussée sur un appareil, l'installation de l'application (recette, partie 8), l'exploitation (partie 9) et l'état de la base hébergée.

## 1. Résultat des vérifications

| Vérification                                | Résultat                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Formatage, lint, types — copie de travail   | Réussis (un avertissement connu de React Compiler sur TanStack Table)                                                    |
| Formatage — `main` tel que commité          | **Échec** depuis le 27 septembre (B1)                                                                                    |
| Tests unitaires et base, Europe/Paris       | 437 réussis, 23 fichiers                                                                                                 |
| Tests unitaires, UTC                        | 235 réussis, 22 fichiers                                                                                                 |
| Construction de production                  | Réussie, deux fois (pile locale, puis configuration normale)                                                             |
| Recette fonctionnelle, pile Supabase locale | 30 étapes sur 30, deux défauts constatés (C1, C2)                                                                        |
| Reproductions des relectures                | 64 tests réussis, dont ceux qui constatent les défauts                                                                   |
| Parcours e2e du dépôt, compte de recette    | 95 réussis, 8 sautés, 1 échec dû aux données : la seule campagne du projet de recette est close depuis (point mineur 14) |
| Production `https://dispo-sp.vercel.app`    | `/connexion` répond 200                                                                                                  |

## 2. Constats à traiter avant la mise en service

### B1 — L'intégration continue est rouge sur `main` depuis le 27 septembre

Le run 36341950933 du commit 6e375a9 s'arrête au formatage, en 18 secondes : lint, types, tests, construction et parcours ne se sont jamais exécutés. La cause est `docs/BILAN_AVANT_DEPLOIEMENT_2026-09-27.md`, commité sans être formaté. Sa mise en forme est corrigée dans la copie de travail, mais pas commitée. C'est la seconde fois en deux semaines, et Vercel publie toujours sans attendre la CI ; le réglage signalé le 25 septembre n'est toujours pas fait.

**À faire :** commiter la mise en forme et vérifier que la CI repasse au vert. Activer ensuite l'attente de la CI dans Vercel.

### B2 — Un gestionnaire peut réactiver un administrateur désactivé

`private.check_membership_change()` ([20260922100000:98](../supabase/migrations/20260922100000_reactivation_administrateur_devalidation.sql)) ne contrôle un administrateur que s'il était **actif** : « désactiver ou rétrograder un administrateur est un geste d'administrateur ». Le chemin inverse n'est gardé par rien. La policy `membership_write` (`0004:121-123`) et `save_member` (`20260923090000:49-51`) laissent un gestionnaire repasser `active = true` sur le rattachement d'un ADMIN écarté. L'écran lui propose d'ailleurs « Réactiver » dans « Agents désactivés » (`management.tsx:386-398`).

**Conséquence :** un gestionnaire ne peut ni inviter, ni nommer, ni désactiver un administrateur, mais il peut en faire revenir un, qui nomme aussitôt qui il veut. C'est contraire au principe « on ne donne pas plus que ce qu'on a » (`20260920090000:28-45`).

**Preuve :** reproduit, `sql/constats.test.ts` › F1, par `save_member` puis par une mise à jour directe.

**À faire :** dans `check_membership_change`, refuser tout passage à `role = 'ADMIN' and active` qui ne l'était pas déjà, sauf si `is_administrator()` est vrai. Ajouter un test.

## 3. Constats importants

### C1 — Réaffecté et republié après un désistement accepté, l'agent se croit encore délié

Joué de bout en bout (`fonctionnel/05-suite.spec.ts` › 4.7) :

1. Damien se désiste de la garde de jour du 4 novembre, et l'encadrement accepte.
2. Le gestionnaire le remplace et republie. Puis, Damien finalement disponible, il le réaffecte et republie : c'est la version 3.
3. **Mon planning** de Damien montre bien la garde, mais avec la pastille verte « Désistement accepté », et le bouton « Je ne peux plus » a disparu. Un agent qui lit « accepté » sur une garde ne s'y présente pas.
4. **Demandes** affiche toujours « Toujours au planning publié — le remplacement reste à faire ».
5. Au moment de la réaffectation, le **vivier du Planning** proposait Damien sans rien rappeler de sa décision.

**Cause :** il existe trois règles pour dire qu'une garde n'est plus celle de l'agent. Une seule est juste : `relievedFrom` (`domain.ts:361-378`), qui compare la date de décision à celle de la publication. L'accueil, l'agenda `.ics` et la base l'appliquent. Les autres écrans regardent autre chose :

- `my-planning.tsx:189-197` et `:302-306` lisent l'état de la dernière demande, quoi qu'il se soit passé depuis ;
- `withdrawals.tsx:104` réclame un remplacement dès que l'agent figure dans la version publiée ;
- `withdrawnFrom` (`domain.ts:461-466`) repose sur un drapeau calculé sur le brouillon (`data-mapping.ts:604-611`). Il sert au vivier du Planning (`planning.tsx:87`) et aux statistiques (`statistics.tsx:299`). Quand l'agent est retiré du brouillon sans republication possible, une garde dont il a été délié redevient « effectuée » dans ses statistiques.

**Preuves :** `fonctionnel/05-suite.spec.ts` › 4.7, `ecrans/desistements.test.ts`, `serveur/desistements.test.ts`.

**À faire :** utiliser `relievedFrom` dans ces quatre écrans, et réserver `withdrawnFrom` au brouillon. Dans le vivier du Planning, signaler l'agent dont le désistement sur ce créneau a été accepté.

### C2 — Sur un mois de 30 jours, la grille de couverture du tableau de bord affiche chaque jour sous la date suivante

`.heatmap` a toujours une colonne d'étiquette et 31 colonnes de dates (`globals.css:1027`). Pour un mois de 30 jours, la ligne des dates n'en remplit que 30. La rangée « Jour » commence donc dans la colonne de l'étiquette, et l'étiquette « Nuit » tombe au bout de la première ligne. **Sous la date N s'affiche la couverture du jour N+1.**

C'est le cas en novembre, premier mois du pilote, ainsi qu'en avril, juin, septembre et février. Les noms accessibles des cases restent justes ; seule la lecture à l'œil est fausse.

**Preuve :** `fonctionnel/02b-grille.spec.ts`, avec les positions mesurées dans le navigateur. Décembre (31 jours) est aligné à 0 px près. En novembre, chaque case est décalée de 52 px, soit exactement une colonne : 48 px d'étiquette et 4 px d'espacement.

**À faire :** poser le nombre de colonnes depuis `days.length`, par exemple avec une variable CSS écrite par `dashboard.tsx:241`.

### C3 — Une erreur de configuration Resend fait échouer définitivement toute la file d'emails

`finish_email_delivery` (`20260927090000:347-356`) classe comme définitif tout refus 4xx autre que 409 et 429. Il traite aussi un 429 comme passager, abandonné après cinq essais étalés sur une demi-heure. Or ces codes disent aussi « le compte est mal réglé » :

- 403 : domaine d'envoi non vérifié ;
- 401 : clé révoquée ;
- 422 : adresse `from` mal formée ;
- 429 : quota du jour atteint.

Une seule commande solde alors jusqu'à 200 messages en `failed`, et rien ne les reprend une fois la configuration corrigée : `claim_email_deliveries` ne relit que `pending` et `sending`. C'est le risque typique de la première campagne, avec un Resend dont la configuration n'a pas encore été vérifiée. La recette promet le contraire (« Rien n'est perdu », `RECETTE.md:166`). Le centre de messages de l'application garde bien chaque notification.

**Preuve :** `serveur/envois.test.ts`, sur une vraie base, avec 403, 401 et 429. Témoin : sur un 503, les 25 messages restent en file.

**À faire :** traiter 401, 403, le 422 portant sur `from` et le 429 de quota comme des erreurs de compte. Le passage s'arrête alors, sans consommer de tentative, et l'erreur est écrite une fois au journal. Seuls les refus propres à un destinataire passent en `failed`.

### C4 — Un agent rattaché pendant un verrouillage n'est jamais inscrit à la campagne déverrouillée

L'inscription automatique des arrivées tardives ignore les campagnes verrouillées : `join_open_campaigns` exige `not c.locked` (`20260925090000:53`). De plus, elle ne se déclenche que sur `memberships` (`:72-74`). Si l'on déverrouille ensuite, ce que l'écran propose tant que la clôture n'est pas passée (`management.tsx:162-171`), l'agent n'est pas participant. Il ne reçoit pas l'avis d'ouverture, et sa saisie comme l'application de son modèle sont refusées (« Not a participant »). Seul détour : le désactiver puis le réactiver.

**Preuve :** `sql/constats.test.ts` › F2.

**À faire :** un déclencheur `after update of locked` sur `availability_campaigns` qui, au déverrouillage d'une campagne non close, inscrit les membres actifs absents de l'équipe.

### C5 — Après un refus, l'agent ne peut plus se désister de la même garde

`my-planning.tsx:189-197` retient la dernière demande non retirée. Quand elle est refusée, l'écran affiche « Désistement refusé » et plus aucun bouton (`:302-306`). La base, elle, accepte une nouvelle demande : l'unicité ne porte que sur les demandes en attente (`20260919200000:50-53`). Un agent dont la situation s'aggrave après un refus ne peut plus le dire depuis l'application.

**Preuve :** `ecrans/desistements.test.ts`.

**À faire :** proposer « Je ne peux plus » quand la dernière demande est refusée, en gardant la mention du refus.

### C6 — Un changement d'équipe laisse l'agent dans les campagnes de l'ancienne

Ce constat ne touche pas un centre à une seule équipe : il devient important dès la deuxième. Les éléments en cause :

- l'invité rejoint l'équipe de l'invitant (`commands.server.ts:480`) ;
- l'inscription aux campagnes ouvertes ne retire rien quand l'équipe change (`20260925090000:19-21`) ;
- la relance ne filtre pas sur l'équipe (`20260923200000:64-71`) ;
- `campaignAgents` (`domain.ts:450-455`) compte tous les participants actifs.

Un agent invité par un gestionnaire d'Alpha puis placé dans Bravo reste donc convié et relancé par la campagne d'Alpha, où il compte comme non-répondant. S'il valide les deux, il peut être publié par les deux plannings sur la même garde : la publication ne regarde pas les autres plannings.

**Preuves :** `serveur/equipes.test.ts`, `sql/constats.test.ts` › F5.

**À faire :** au changement d'équipe, retirer la participation aux campagnes ouvertes de l'ancienne équipe si l'agent n'y a rien saisi. Refuser à la publication un agent déjà publié sur la même date et le même créneau. À terme, demander l'équipe à l'invitation.

## 4. Points mineurs

| #   | Point                                                                                                                                                                                                                                                                                                     | Où                                                                       | Preuve                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| 1   | « Appliquer à plusieurs journées » arrive prérempli de 6 agents et de minima figés, étrangers au catalogue du centre (« Chef » 1, « Conducteur PL » 1, « SAP » 3). Appliqué tel quel, il crée deux qualifications que personne ne détient, et aucun créneau ne se publie plus                             | `needs.tsx:169-170`, `domain.ts:386-389`                                 | `fonctionnel/04-planning.spec.ts` › 4.1  |
| 2   | Un agent qui tape `/agents` ou `/tableau-de-bord` reste sur l'adresse et voit « Espace encadrement » : la redirection serveur part dans la réponse, mais le bandeau remplace la page qui l'exécuterait. Aucune donnée n'est montrée ; la recette et le commentaire du garde décrivent autre chose         | `shell.tsx:258-265`, `manager-page.ts:18-21`, `tableau-de-bord/page.tsx` | `fonctionnel/09-redirection.spec.ts`     |
| 3   | Mon planning › Historique est vide par défaut pendant la collecte : il ne lit que la campagne choisie (le mois suivant), et le message affiché est faux                                                                                                                                                   | `my-planning.tsx:55-65,140,154-158`                                      | `ecrans/autres-defauts.test.ts`          |
| 4   | La fenêtre de notifications renvoie l'encadrement vers « Mon profil », absent de sa navigation                                                                                                                                                                                                            | `pwa.tsx:459,480`, `shell.tsx:32-47`                                     | `ecrans/autres-defauts.test.ts`          |
| 5   | « Verrouiller la saisie » est proposé sur une campagne close depuis longtemps ; sur une archive non chargée, la commande ne part jamais                                                                                                                                                                   | `management.tsx:150-178`                                                 | `ecrans/autres-defauts.test.ts`          |
| 6   | Invitation : un champ invalide ne donne que « La demande est incomplète ou mal formée. » ; après « le message n'a pas pu partir », la fenêtre reste remplie, et un second clic se heurte à « existe déjà »                                                                                                | `management.tsx:699-741`                                                 | `ecrans/autres-defauts.test.ts`          |
| 7   | Les listes d'agents suivent l'ordre des identifiants, pas l'ordre alphabétique (tableau de bord : Bruno, Gaston, Chloé) ; le CSV ignore le tri choisi à l'écran                                                                                                                                           | `data.server.ts:97`, `availability-table.tsx:186-191`                    | `ecrans/autres-defauts.test.ts`, capture |
| 8   | Menu mobile : le bouton ne dit pas s'il est ouvert, Échap ne le ferme pas, ses liens restent atteignables une fois fermé ; la pastille Demandes manque à la barre du bas                                                                                                                                  | `shell.tsx:171,294-300`, `globals.css:3529-3536`                         | Lecture                                  |
| 9   | La base accepte un désistement sur une garde déjà passée ; un refus tranché après que l'agent a été remplacé lui écrit « Vous restez attendu sur cette garde »                                                                                                                                            | `20260919200000:59-69,80-87`, `20260925150000:89-99`                     | `sql/constats.test.ts` › F3              |
| 10  | Le journal ne garde pas les minima de qualification d'un besoin : passer SAP de 1 à 2 n'y laisse qu'un « SET » à effectif inchangé                                                                                                                                                                        | `0003_client_writes.sql:103-107`                                         | `sql/constats.test.ts` › F6              |
| 11  | `retirer-un-compte.sql` appliqué à un gestionnaire qui a invité : chaque invitation passée au relais écrit au journal une modification sans auteur, avec l'identifiant retiré                                                                                                                             | `retirer-un-compte.sql:105-107,123,129-137`                              | `sql/constats.test.ts` › F4              |
| 12  | `claim_email_deliveries` : depuis `20260923200000:227-231`, repris le 27 septembre (`:327-331`), l'étape qui verrouille ne refiltre plus la ligne. Deux passages simultanés peuvent réserver la même ligne. La clé d'idempotence évite le second email, mais le plafond de 10 par heure peut être dépassé | `20260927090000:327-331`                                                 | Lecture (PGlite n'a qu'une connexion)    |
| 13  | Le formulaire de campagne n'a pas `noValidate` : une clôture passée est refusée par la bulle du navigateur, dans la langue de celui-ci, et non par l'application                                                                                                                                          | `management.tsx:199-248`                                                 | `fonctionnel/02-campagne.spec.ts`        |
| 14  | Le parcours e2e « aucun champ ne sort d'une boîte de dialogue » échoue depuis que la seule campagne du projet de recette est close : « Saisie rapide » y est inactif. Le test dépend de la date et des données hébergées                                                                                  | `tests/e2e/responsive.spec.ts:189-200`                                   | Rejoué deux fois, échec constant         |

## 5. Points ouverts repris des analyses précédentes

Toujours ouverts, sans changement de code depuis leur constat :

- **Export RGPD avec données de tiers** (C4 du 25 septembre, n° 3 du bilan) : `exporter-les-donnees-d-un-compte.sql` n'a pas changé depuis le commit 694a20e.
- **`retirer-un-compte.sql`** retire le dernier administrateur dès qu'un gestionnaire reste, et choisit au hasard le centre d'un compte à deux rattachements (C3 du 25 septembre). La relecture de la base le confirme.
- **Traces personnelles qui survivent au retrait** (C5 du 25 septembre).
- **Décision C6** : l'encadrement doit-il figurer dans les campagnes ? Le tableau de bord compte aujourd'hui « 0 / 6 », administratrice et gestionnaire compris.
- **Aucune reprise périodique des deux files d'envoi** : un échec passager attend la prochaine commande de quelqu'un.
- **Fiche globale lisible par l'ancien centre** d'un agent transféré (gardée pour les noms des gardes passées).
- **Vercel publie sans attendre la CI** (voir B1). `NEXT_DEPLOYMENT_ID` sur l'hébergeur et la vérification sur de vrais appareils restent à faire.

## 6. Ce qui est vérifié comme sain

**Dans le navigateur, sur la pile locale :**

- l'arrivée complète d'un agent :
  - invitation, puis message d'activation au gabarit français, avec un lien vers le site et non vers `localhost` ;
  - activation depuis un autre navigateur ;
  - compte déjà confirmé rattaché sans message ; compte non confirmé laissé en attente ;
  - mot de passe oublié, avec la même réponse pour une adresse inconnue et un lien à usage unique ;
- la campagne :
  - création atomique de 62 créneaux et inscription des 6 membres actifs ;
  - inscription et avis pour les arrivées tardives ;
  - refus explicites (nom court, mois déjà ouvert, clôture passée) ;
- la saisie :
  - modèle hebdomadaire appliqué aux seuls jours concernés et conservé à la reconnexion ;
  - validation impossible tant que le mois est incomplet ;
  - invalidation dès qu'un jour change ;
- le planning :
  - besoins en lot puis réglage d'un seul créneau ;
  - déficit affiché avec ce qui manque et publication inactive ;
  - qualification exigée tenue ;
  - l'agent ne voit que ses gardes publiées ;
  - désistement, décision, rappel de remplacement, republication ;
  - avis à l'agent retiré sans désistement, et pas d'avis doublé après un désistement accepté ;
- relance des seuls non-validés, seconde relance refusée pendant 12 heures, verrouillage avec message clair ;
- les exports :
  - classeur de six feuilles ;
  - CSV avec BOM et accents ;
  - impression de toutes les lignes ;
  - journal ;
  - `.ics` (garde du 4 novembre de 07:00Z à 19:00Z, soit 8 h–20 h à Paris) ;
- les droits : aucune donnée d'encadrement pour un agent, et un modèle personnel invisible de l'administration ;
- paramètres, équipes, désactivation et réactivation, renvoi et annulation d'invitation, notifications marquées lues.

**Par les relectures :**

- **Concordance du code avec le schéma final.**
  - Les 14 appels `.rpc()` : nom, paramètres, droits d'exécution.
  - Chaque colonne écrite a son droit, chaque relation imbriquée sa clé étrangère.
  - Chaque `raise exception` des migrations a sa traduction à l'écran.
- **Isolation entre centres** : 17 tables illisibles, 16 écritures refusées, 8 mises à jour sans effet.
- **Fonctions accessibles à une session** : aucune pour `anon` sous les privilèges par défaut de Supabase ; les fonctions `security definer` ont toutes un chemin de recherche vide.
- **Fuseau horaire.**
  - Clôture les 24 et 25 octobre, passage à l'heure d'hiver respecté.
  - Nuit du 24 au 25 octobre de 13 h dans le `.ics`.
  - Février et mois de 30 ou 31 jours, en UTC comme à Paris.
- **Les sept scripts de provisionnement**, joués sur un centre peuplé.
- **Proxy et routes** : en-têtes de sécurité, contrôle d'origine sur toutes les routes écrites à la main.
- **Files d'envoi** : bail et clé d'idempotence.

## 7. Documentation à rectifier

- `RECETTE.md:166` : « Rien n'est perdu » est faux pour une erreur de configuration Resend (C3).
- `RECETTE.md:283-285` : il n'existe pas d'écran « Accès réservé », et `/tableau-de-bord` ne renvoie pas l'agent vers son accueil (mineur 2). Même correction dans le commentaire de `manager-page.ts`.
- `premiere-campagne.sql` : l'en-tête dit « Temporaire : la création depuis l'interface arrivera… », alors que l'écran Campagnes crée les suivantes et que seule la première passe par le script. Le nom de centre par défaut (`'CIS Nice Bon Voyage'`, ligne 13) ne correspond pas à celui de `premiere-organisation.sql` (`'CIS Exemple'`).
- `README.md` : le passage de `20260927090000` à « Appliquée » est fait dans la copie de travail mais pas commité.

## 8. Tests à ajouter

- **Base** :
  - un gestionnaire ne réactive pas un administrateur (B2) ;
  - le déverrouillage inscrit les arrivées (C4) ;
  - la réservation des emails refiltre la ligne verrouillée (mineur 12).
- **Domaine et écrans** : après réaffectation et republication, ni « Désistement accepté » ni rappel de remplacement, et « Je ne peux plus » de nouveau proposé (C1, C5).
- **Envois** : un 401, un 403 ou le 429 de quota arrêtent le passage sans solder la file (C3).
- **Navigateur** :
  - alignement de la grille de couverture sur un mois de 30 jours (C2) ;
  - un agent qui tape une adresse d'encadrement (mineur 2) ;
  - le parcours responsive ne doit plus dépendre d'une campagne ouverte sur le projet de recette (mineur 14).

## 9. Ordre de travail recommandé

1. **B1** : commiter la mise en forme, vérifier la CI verte, activer l'attente de la CI dans Vercel.
2. **B2, C4 et mineur 12** dans une même migration, avec leurs tests ; l'appliquer avant de déployer.
3. **C1 et C5** : une seule règle de désistement pour tous les écrans.
4. **C2** : une ligne de CSS, avant que l'encadrement ne lise novembre.
5. **C3** : erreurs de compte Resend.
6. **Mineurs 1 à 8**, puis la documentation (chapitre 7).
7. **Avant toute donnée réelle :** les points RGPD du chapitre 5, et la vérification sur de vrais appareils (recette, partie 8).
8. **Dès la deuxième équipe :** C6.

## Vérifications exécutées

- `gh run list` et `gh run view 36341950933` : échec au formatage sur 6e375a9.
- Copie de travail :
  - `pnpm format:check`, `pnpm lint`, `pnpm typecheck` ;
  - `pnpm test` en Europe/Paris (437) ;
  - `pnpm vitest run --exclude tests/database.test.ts` en UTC (235) ;
  - `pnpm build` ;
  - `pnpm test:e2e` : 95 réussis, 8 sautés, 1 échec dû aux données hébergées.
- Pile Supabase locale. CLI 2.117, configuration conservée dans `.local/audit-20261005/pile-locale/config.toml` :
  - 28 migrations appliquées sans erreur ;
  - `premiere-organisation.sql` et `premiere-campagne.sql` exécutés ;
  - application construite et servie sur le port 3100, Resend désactivé ;
  - 30 étapes Playwright dans `.local/audit-20261005/fonctionnel/`.
- Le journal du serveur pendant la recette ne contient que :
  - les refus voulus par les tests ;
  - l'interruption de flux déjà connue ;
  - trois lectures refusées pour un jeton « émis dans le futur », dû au décalage d'horloge de la pile Docker locale. L'écran les a présentées comme une lecture incomplète.
- Reproductions : `.local/audit-20261005/sql/` (18 tests), `serveur/` (21), `ecrans/` (25).
- Production : `GET /connexion` répond 200.

**Non vérifié :**

- la réception d'un email par Resend ;
- une notification poussée sur un vrai appareil ;
- l'installation de l'application ;
- la sauvegarde ;
- l'état de la base hébergée : migration appliquée selon le porteur du projet, non contrôlée ;
- le comportement concurrent réel de la réservation des emails (mineur 12, lecture seule).
