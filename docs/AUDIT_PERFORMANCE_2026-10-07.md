# Audit de performance — 7 octobre 2026

Version examinée : commit **78d39b0** sur **main** (« suppression Conducteur dans la fonction »), copie de travail propre. Aucun fichier du dépôt n'a été modifié pour cet audit ; tout ce qui a servi à mesurer est dans `.local/audit-20261007/` (dossier ignoré par git).

**En une phrase :** sur un petit centre, l'application est rapide — un écran s'affiche en 0,4 à 0,7 s, en production comme en local. Mais sur un centre de taille réelle après un an d'usage (80 agents, 13 mois), **chaque écran d'encadrement met 19 à 21 s à s'afficher, chaque affectation laisse le planning en attente 19 s, et la lecture dépasse parfois le délai de 8 s de la base : l'écran tombe alors en erreur.** La cause est unique et se corrige en base (B1). Le prototype de correctif, mesuré sur la même pile, ramène les écrans à 1 à 2 s et l'attente après un geste à 1,5 s, sans changer une seule ligne lue. Restent des gains plus modestes côté navigateur, dont le plus important est de ne plus envoyer tout le centre à chaque page (C1).

## Suivi des correctifs — 7 octobre 2026, l'après-midi

Ce suivi prévaut sur l'état du chapitre 2, conservé tel quel comme constat initial.

| Point | Correctif                                                                                                                                                                                                                                                                                                                                                                                            | Test                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | Migration `20261007150000_droits_par_ensemble.sql`. Elle crée `private.my_organizations()` et `private.managed_organizations()`, qui rendent l'ensemble des centres de l'appelant, et réécrit en clair les 36 règles qui appelaient `is_member()`, `can_manage()` ou `can_administer()` : seul l'appel change. Les anciennes fonctions restent, pour les quatre fonctions qui s'en servent une fois. | `database.test.ts` : aucune règle n'appelle plus les anciennes fonctions ; les deux ensembles pour un agent, un gestionnaire, un administrateur, un autre centre, un compte désactivé et sans session ; refus aux visiteurs ; isolation des centres ; gardes d'application. Ces tests échouent sans la migration, sauf le refus aux visiteurs, qui pose une garantie. |

**Preuves :**

- **Mêmes règles que le prototype mesuré.** Sur deux bases neuves, le texte que PostgreSQL réimprime des 49 règles du schéma `public` est identique, caractère pour caractère, avec la migration et avec le prototype, ainsi que les deux fonctions (`.local/audit-20261007/b1/equivalence.test.ts`). Changer un seul mot d'une règle fait échouer la comparaison.
- **Appliquée telle qu'elle sera collée, sur PostgreSQL 17 de Supabase.** Sur la pile locale, après remise des 36 règles d'origine (`b1/restaurer-origine.sql`) : 36 `ALTER POLICY`, et un second passage refusé. Les affectations d'un gestionnaire se lisent alors en **0,14 s au lieu de 13,6 s**, les créneaux en 0,02 s au lieu de 2,5 s, les besoins d'un agent en 0,04 s au lieu de 2,4 s. Les nombres de lignes sont identiques (`volume/mesures/postgrest-origine-restauree.json`, `postgrest-migration.json`).
- **Les droits ne changent pas.** Les 232 tests de `database.test.ts` passent sur le schéma migré. Les deux contre-épreuves du chapitre 2 montrent que ces tests voient bien les règles réécrites.

**Vérifications après correction :** formatage, lint (l'avertissement connu de TanStack Table), types, 483 tests en Europe/Paris et 251 en UTC.

**Ordre de déploiement :** aucun code ne dépend de cette migration. Elle s'applique par-dessus `20261007090000_conduite.sql`, avant ou après le déploiement, en collant le fichier entier dans l'éditeur SQL.

**Non rejoué :** les écrans dans le navigateur avec la migration elle-même. Ils ont été mesurés avec le prototype (§ 1.2 et 1.3), dont les règles sont identiques.

## Périmètre et niveau de preuve

- **Un centre de taille réelle, sur une pile Supabase locale.** Le volume :
  - 80 agents actifs (deux équipes de 40) et 5 désactivés ;
  - 13 campagnes mensuelles par équipe, de novembre 2025 à novembre 2026 ;
  - 31 515 disponibilités, 1 580 créneaux, autant de besoins, et 10 360 affectations ;
  - 40 désistements, 2 459 notifications et 6 259 lignes de journal.

  La pile est celle de l'audit du 5 octobre : PostgreSQL 17 de Supabase, GoTrue, PostgREST, avec les 31 migrations. Le jeu est créé par `volume/seed.sql`. L'application est construite par `next build` et servie par `next start`.

- **Les écrans, dans Chromium** (`volume/ecrans.perf.ts`), sur deux profils :
  - un ordinateur sans bridage ;
  - un téléphone : processeur ralenti 4 fois et réseau « 4G lente » de Lighthouse (150 ms, 1,6 Mbit/s), écran 390 × 844.

  On relève le premier octet, le premier affichage (FCP), le plus grand affichage (LCP), le temps de blocage (TBT), le décalage de mise en page (CLS), les poids et la mémoire. Médiane de 2 chargements sur ordinateur ; 1 seul sur téléphone, faute de temps à ce volume (plus de 20 s par chargement avant correctif).

- **Les gestes** (`volume/interactions.perf.ts`) : affecter puis retirer un agent sur le planning, changer d'écran, puis, côté agent, saisir un jour. On mesure le temps jusqu'au message, puis jusqu'à la fin de la relecture de l'état (disparition de la barre d'attente).
- **Les lectures de la base** (`volume/postgrest.mjs`) : chaque table lourde lue comme le fait `loadState`, sous l'identité d'un gestionnaire puis d'un agent. Pages de 500 lignes, la première avec le compte exact, les suivantes six à la fois. Médiane de 3.
- **Le code du navigateur** (`perf-code/`, 15 tests) :
  - calculs et rendus mesurés sur ce même volume, sous Node 22.15, avec React 19.3 en mode production et `renderToString` (une borne basse : le DOM n'est pas compté) ;
  - poids des morceaux de JavaScript lus dans la construction ;
  - chaque prototype vérifié contre l'original : même résultat, ou même HTML au caractère près.
- **La production** (`https://dispo-sp.vercel.app`), en lecture seule, avec le compte de recette. Le projet hébergé ne contient qu'une campagne : ces mesures disent ce que valent le réseau, la compression et le cache, pas la tenue en charge.

**Non vérifié :** voir la fin du document. Le plus important : la base hébergée n'a pas été mesurée à ce volume, et sa machine est probablement plus lente que le poste de bureau qui a servi ici.

## 1. Mesures

### 1.1 Lectures de la base — avant et après le prototype B1

Temps total pour lire chaque table en entier, comme `loadState` la lit.

| Table          | Gestionnaire : lignes | Avant : 1re page avec compte | Avant : page suivante | Avant : total | Après : total |
| -------------- | --------------------: | ---------------------------: | --------------------: | ------------: | ------------: |
| Affectations   |                10 360 |                        3,1 s |                 2,9 s |    **14,6 s** |    **0,18 s** |
| Créneaux       |                 1 580 |                        1,6 s |                 1,0 s |         2,6 s |        0,02 s |
| Besoins        |                 1 580 |                        0,2 s |                 0,6 s |         0,9 s |        0,05 s |
| Disponibilités |                31 515 |                       0,06 s |                0,05 s |         0,6 s |        0,23 s |
| Participants   |                 1 053 |                       0,05 s |                0,03 s |        0,08 s |        0,02 s |
| Désistements   |                    40 |                       0,05 s |                     — |        0,05 s |        0,01 s |

| Table          | Agent : lignes | Avant : total | Après : total |
| -------------- | -------------: | ------------: | ------------: |
| Affectations   |             66 |         0,9 s |        0,02 s |
| Créneaux       |          1 580 |         1,3 s |        0,02 s |
| Besoins        |          1 580 |         2,4 s |        0,04 s |
| Disponibilités |            395 |        0,04 s |        0,03 s |

Les nombres de lignes sont identiques avant et après : chacun voit exactement ce qu'il voyait.

### 1.2 Écrans — plus grand affichage (LCP)

| Écran                                | Avant, ordinateur | Après, ordinateur | Avant, téléphone | Après, téléphone |
| ------------------------------------ | ----------------: | ----------------: | ---------------: | ---------------: |
| Gestionnaire — Tableau de bord       |            21,3 s |             1,8 s |                — |                — |
| Gestionnaire — Disponibilités        |            21,2 s |             1,5 s |           23,2 s |            2,2 s |
| Gestionnaire — Planning              |            20,8 s |             1,4 s |           23,6 s |            2,5 s |
| Gestionnaire — Besoins               |            21,6 s |             1,1 s |                — |                — |
| Gestionnaire — Campagnes             |            20,0 s |             1,3 s |                — |                — |
| Gestionnaire — Agents                |            19,4 s |             1,1 s |                — |                — |
| Gestionnaire — Demandes              |            20,5 s |             1,0 s |                — |                — |
| Gestionnaire — Statistiques          |            19,5 s |             1,2 s |                — |                — |
| Gestionnaire — Historique            |            18,8 s |             1,2 s |                — |                — |
| Agent — Accueil                      |             4,3 s |            0,29 s |            5,1 s |           0,91 s |
| Agent — Mes disponibilités           |             4,6 s |            0,30 s |            5,0 s |           0,91 s |
| Agent — Mon planning                 |             9,8 s |            0,28 s |            4,8 s |           0,74 s |
| Agent — Notifications                |             4,4 s |            0,26 s |                — |                — |
| Petit centre (6 participants), local |       0,38–0,40 s |                 — |            0,9 s |                — |

Ce que le correctif B1 ne change pas, et qui relève de C1 :

| Mesure                                 | Gestionnaire, grand centre | Agent, grand centre | Production, petit centre |
| -------------------------------------- | -------------------------: | ------------------: | -----------------------: |
| Document HTML décodé                   |             5 113–5 201 Ko |          263–278 Ko |                 39–63 Ko |
| Document transmis (gzip, `next start`) |                     233 Ko |                   — |       compressé (Vercel) |
| JavaScript décodé par page             |             1 012–1 094 Ko |      1 007–1 019 Ko |           1 015–1 095 Ko |
| Blocage (TBT), téléphone, après B1     |                  1,4–1,5 s |         0,12–0,26 s |              0,02–0,25 s |
| Plus longue tâche, téléphone, après B1 |                 572–836 ms |          114–233 ms |                73–243 ms |
| Mémoire JavaScript                     |                   36–40 Mo |               17 Mo |                    17 Mo |

### 1.3 Gestes

| Geste (ordinateur)                            |      Avant |     Après |
| --------------------------------------------- | ---------: | --------: |
| Affecter un agent : message affiché           |     0,28 s |    0,30 s |
| Affecter un agent : fin de la relecture       | **19,0 s** | **1,6 s** |
| Retirer un agent : fin de la relecture        |     19,1 s |     1,4 s |
| Agent, saisir un jour : fin de la relecture   |      4,9 s |    0,85 s |
| Changer d'écran, état lu il y a moins de 30 s |      0,4 s |     0,4 s |

L'action elle-même est rapide : le message arrive en 0,3 s. C'est la relecture de tout l'état qui suit (`router.refresh()`, `provider.tsx:197`) qui laisse la barre d'attente affichée.

### 1.4 Production

Compte de recette, petit centre, médiane de 3 :

- **Premier octet :** 143 à 210 ms.
- **Plus grand affichage :** 0,51 à 0,56 s sur ordinateur, 0,63 à 0,72 s sur téléphone bridé. Blocage au plus 249 ms.
- **Compression :** les documents sont compressés.
- **Mise en cache :** les morceaux statiques sont servis en brotli, marqués `immutable` pour un an et trouvés en cache par le réseau de Vercel (`HIT`).
- **Démarrage à froid :** une première requête sur `/connexion` après un temps d'inactivité a pris 1,62 s, contre environ 170 ms ensuite.
- **Routage :** la requête entre par Paris (`cdg1`) et la fonction s'exécute à Dublin (`dub1`), dans la même région que le projet Supabase (Irlande, `eu-west-1`, région confirmée par le porteur du projet le 24 septembre).

## 2. Constat bloquant à l'échelle d'un centre réel

### B1 — Les règles d'accès appellent une fonction pour chaque ligne lue : 20 s par écran d'encadrement, et des écrans en erreur

**Constat.** Les règles de lecture (RLS) testent l'appartenance au centre par des fonctions `security definer` :

- `private.is_member(org)` : `0001_foundation.sql:44` ;
- `private.can_manage(org, team)` : `20260919120000_grades_fonctions_roles.sql:57` ;
- `private.can_administer(org)` : `0003_client_writes.sql:23`.

PostgreSQL ne peut pas intégrer une telle fonction à la requête : il l'appelle pour chaque ligne examinée, et chaque appel relit le jeton puis `memberships`. Ces appels coûtent environ 0,24 ms chacun (mesuré par `EXPLAIN ANALYZE`, `volume/explain-affectations.sql`).

Sur les affectations, le cas le plus lourd, un gestionnaire paie jusqu'à quatre appels par ligne :

- la règle `assignment_read` (`0002_planning.sql:202-212`) joint le créneau et le planning, et appelle `can_manage` ;
- la lecture du créneau, dans cette règle, passe à son tour par `schedule_shift_read` (`is_member`, `0002_planning.sql:194`), et celle du planning par `schedule_read` (`is_member`, ligne 192) ;
- la jointure `schedule_shifts!inner` de `loadState` (`data.server.ts:250`) refait le contrôle sur le créneau.

**Pourquoi le coût explose avec le volume.** La lecture se fait par pages de 500, triées (`data.server.ts:255-257`). Pour servir n'importe quelle page, la base doit d'abord filtrer et trier **toute** la table, donc appeler la fonction pour chaque ligne de la table. Une page sans compte coûte ainsi autant que la première : 2,9 s contre 3,1 s.

Le coût total croît donc comme le carré du volume : il y a deux fois plus de pages, et chacune coûte deux fois plus. Pour 10 360 affectations : 21 pages, six à la fois, soit 14,6 s.

Les trois vagues de `loadState` (`data.server.ts:73`, `:168`, `:232`) s'enchaînent : on retrouve les 19 à 21 s mesurées à l'écran.

**Conséquences constatées :**

- **Écrans d'encadrement :** 19 à 21 s sur ordinateur, 23 s sur téléphone.
- **Écrans d'agent :** 4 à 10 s. La RLS examine les affectations et les besoins de tout le centre pour n'en rendre que les siens.
- **Chaque geste :** chaque commande relit l'état entier (`provider.tsx:197`). Une affectation laisse le planning en attente 19 s. Un changement d'écran relit lui aussi tout, dès que l'état a plus de 30 s (`provider.tsx:246-248`).
- **Des écrans en erreur.** Une lecture qui dépasse `statement_timeout` (8 s pour `authenticated`) est annulée. Pendant la première série de gestes, le poste exécutait en même temps les mesures du code. Trois lectures des affectations ont été annulées (« canceling statement due to statement timeout », `server.log`), et le planning a affiché « Cet écran n'a pas pu s'afficher. » Plus tôt dans la journée, la première page des affectations avec son compte avait pris 8,05 s, et PostgREST avait répondu 500.

À ce volume, un gestionnaire seul suffit à frôler la limite : deux encadrants qui ouvrent l'application en même temps, ou une base hébergée plus lente que ce poste, la franchiront plus souvent. Ce dernier point n'est pas mesuré.

**Correctif proposé, prototypé et mesuré** (`volume/prototype-rls.sql`, appliqué à la pile locale seulement) :

- **Deux fonctions qui rendent des ensembles.** `private.my_organizations()` rend les centres où l'appelant est membre actif ; `private.managed_organizations()`, ceux où il est gestionnaire ou administrateur.
- **Chaque règle teste l'appartenance à cet ensemble.** Elle écrit `organization_id in (select private.my_organizations())`, que PostgreSQL calcule **une fois par requête** puis consulte dans une table de hachage.
- **Les mêmes conditions qu'aujourd'hui.**
  - `can_manage()` ignore déjà l'équipe depuis le 19 septembre, et `can_administer()` porte la même condition qu'elle : les deux deviennent `managed_organizations()`.
  - Sans session, l'ensemble est vide et la règle refuse, comme aujourd'hui.

**Résultat :** les 36 règles réécrites. Les affectations se lisent en 0,18 s au lieu de 14,6 s. Les écrans d'encadrement passent de 19–21 s à 1,0–1,8 s, et la relecture après un geste de 19 s à 1,4–1,6 s (§ 1.1 à 1.3).

**Preuve que les droits n'ont pas changé :**

- **Les suites du dépôt passent avec le prototype.** `database.test.ts` et `provisioning.test.ts` ont été rejouées sur PGlite, prototype ajouté en dernière migration (`rls-tests/`) : **243 tests sur 243**.
- **Deux contre-épreuves montrent que ces suites voient les règles réécrites :**
  - un prototype qui ouvre tous les centres à tout le monde fait échouer l'isolation des centres (1 test) ;
  - un prototype qui donne à un agent les droits d'encadrement en fait échouer 10 : brouillon visible, besoins, invitations, demandes, fiches d'autres centres…

**Pour la vraie migration :**

- **Écrire les 36 `alter policy` en clair** plutôt que par expression régulière, pour qu'elles se relisent. Les générer une fois depuis `pg_policies`, puis les relire.
- **Garder les trois anciennes fonctions.** `publish_schedule_shift`, `create_campaign`, `remind_campaign` et `reserve_invitation_send` les appellent pour un contrôle ponctuel, où elles ne coûtent rien.
- **Le compte exact du pager peut rester.** Après correctif, la première page avec compte prend 23 ms ; il reste la garantie qu'une lecture est complète (`data-mapping.ts:83-98`).

## 3. Constats importants

### C1 — Tout le centre, sur 13 mois, part dans chaque page et revient après chaque geste

**Constat.** `loadState` est appelé dans la mise en page de l'espace de travail (`(workspace)/layout.tsx:33`) et confié au fournisseur. Il lit le détail de toutes les campagnes des 12 derniers mois (`data.server.ts:166-167`) : disponibilités, besoins, créneaux, affectations. Cet état est sérialisé dans chaque page, puis renvoyé :

- après chaque commande (`provider.tsx:197`) ;
- à chaque navigation dès qu'il a plus de 30 s (`provider.tsx:246-248`).

Mesures sur le grand centre :

- **L'état :** 4 395 Ko de JSON, dont 84 % de disponibilités. Compressé : 186 Ko en gzip, 127 Ko en brotli.
- **Le document d'un écran d'encadrement :** 5,1 Mo décodé. Il passe à 233 Ko une fois compressé : le réseau n'est pas le problème.
- **Côté serveur :** `loadState` émet 96 requêtes, dont 16 allers-retours en série, et 57 ms de calcul.
- **Côté navigateur :** `JSON.parse` de l'état prend 28 ms sur ordinateur. Sur téléphone, après B1, le chargement bloque encore la page 1,4 à 1,5 s, avec une tâche jusqu'à 836 ms, et la mémoire double (36–40 Mo contre 17).
- **Après un geste :** une fois B1 corrigé, c'est ce volume qui fait encore durer la relecture 1,4–1,6 s pour un gestionnaire, contre 0,85 s pour un agent.

**Seul l'écran Statistiques a besoin de plusieurs campagnes :** son tableau « Mois par mois » lit les disponibilités d'autres campagnes que celle choisie (`statistics.tsx:91`). Tous les autres écrans ne lisent que la campagne choisie.

**Correctif proposé :**

- **Ne charger le détail que de la campagne choisie.** Le mécanisme existe déjà pour les archives : `campaignsToLoad` (`data-mapping.ts:294`), le chargement à la demande (`provider.tsx:150-161`) et le sélecteur (`shell.tsx:267`).
- **Calculer « Mois par mois » côté serveur**, dans la page Statistiques.

Prototype mesuré (`perf-code/proto.ts`) :

- l'état passe à 463 Ko de JSON, 28 Ko en gzip ;
- `JSON.parse` prend 2,5 ms ;
- `loadState` émet 23 requêtes, en 4 allers-retours, et calcule 19,5 ms.

Le même raisonnement vaut pour l'agent. Il reçoit les 1 580 créneaux et les 1 580 besoins des deux équipes sur 13 mois, alors que ses écrans ne portent que sur ses campagnes.

### C2 — La bibliothèque de validation (zod) entière est chargée par toutes les pages, connexion comprise

**Constat.** Un morceau de JavaScript ne contient que zod 4 : 382 Ko brut, 88,8 Ko en gzip. Il figure parmi les morceaux chargés par la mise en page racine, soit environ 31 % des quelque 286 Ko gzip du premier chargement, y compris sur `/connexion`. La chaîne d'imports :

- `app/layout.tsx:4` importe `ServiceWorker` de `components/pwa.tsx` ;
- `pwa.tsx` importe `lib/push.ts`, où `z` sert au schéma d'abonnement (ligne 27), qui ne sert qu'au serveur ;
- `pwa.tsx` importe aussi le fournisseur (`pwa.tsx:13`), donc `lib/domain.ts` (zod à la ligne 2). Ce fichier construit dès le chargement deux schémas :
  - `stateSchema` (ligne 89), qui ne sert plus que de type ;
  - `commandSchema` (ligne 652), qu'utilise seul `app/actions.ts:51`, côté serveur.

**Correctif proposé :**

- isoler `ServiceWorker` dans un fichier sans dépendance ;
- déplacer les schémas qui ne servent qu'au serveur dans des modules serveur, avec `import type` pour les types ;
- laisser zod aux seuls formulaires qui en ont besoin, ou passer à `zod/mini`.

**Gain attendu :** jusqu'à 89 Ko gzip de moins sur chaque page, soit environ 0,45 s de téléchargement de moins en 4G lente. Non mesuré : il faudrait une construction modifiée.

### C3 — Le fournisseur fait rendre tout l'écran quatre fois par commande

**Constat.** La valeur du contexte est un objet neuf à chaque rendu (`provider.tsx:292-306`), et `run`, `notice` et `reload` sont recréées aussi. `busy` y figure alors que seul le bandeau d'attente le lit.

Chaque commande provoque donc quatre rendus de tout l'écran :

- le passage à « en cours » (`provider.tsx:184`) ;
- la fin de l'envoi, avec le message ;
- l'arrivée du nouvel état ;
- la disparition du message, 6,5 s plus tard.

Sur Planning, un rendu coûte 28 ms sur ordinateur, au moins 4 fois plus sur le téléphone bridé.

**Correctif proposé :** une valeur mémorisée (`useMemo`), des fonctions stables, et `busy` dans un contexte à part. Ce décompte vient de la lecture du code ; il n'a pas été compté dans un vrai DOM.

### C4 — Des calculs refaits à chaque rendu, linéaires en agents × affectations

Mesures sur le grand centre, en rendu complet. Chaque prototype est vérifié : résultat ou HTML identique.

| Endroit                                                                                          | Avant   | Prototype |
| ------------------------------------------------------------------------------------------------ | ------- | --------- |
| Planning : charge de chaque agent, 80 × `workload` (`planning.tsx:428-430`, `domain.ts:496-502`) | 23,8 ms | 0,65 ms   |
| Planning, rendu complet (avec la ligne précédente et les dates)                                  | 28,1 ms | 3,4 ms    |
| Statistiques « Mois par mois », 806 appels à `coverage` (`statistics.tsx:83-108`)                | 39,7 ms | 17,5 ms   |
| Statistiques « Par agent », 80 × `shiftsHeld` (`statistics.tsx:290`, `domain.ts:380`)            | 28,6 ms | 2,4 ms    |
| Dates : `toLocale*String` à chaque appel (`domain.ts:282-289`), Historique, rendu complet        | 25,8 ms | 5,2 ms    |
| Dates, Besoins, rendu complet                                                                    | 11,1 ms | 1,9 ms    |
| Dates, Demandes, rendu complet                                                                   | 12,9 ms | 4,3 ms    |
| Tableau de bord : couverture calculée deux fois (`dashboard.tsx:48-50` et `:259`)                | 6,5 ms  | 3,3 ms    |

Disponibilités du centre : le rendu prend 26,7 ms, dont 6,6 ms pour les totaux, recalculés à chaque frappe dans la recherche (`availability-table.tsx:69-74`, `:348-353`). La proposition est `useDeferredValue` sur la recherche et `useMemo` sur les totaux ; elle n'est pas prototypée.

**Correctif proposé :** les prototypes de `perf-code/proto.ts`.

- `workloadAll` : un seul passage sur les affectations ;
- `shiftsHeldAll`, avec un index des désistements ;
- `potentialMonth` ;
- un `Intl.DateTimeFormat` gardé par format ;
- la couverture du tableau de bord réutilisée.

Ces calculs ne deviennent sensibles qu'à volume réel, et surtout sur téléphone.

## 4. Points mineurs

| #   | Constat                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Décalage de mise en page (CLS) de 0,19 à 0,20 sur Disponibilités pour le grand centre, au-dessus du seuil de 0,1 ; 0,08 sur le petit centre local, 0,02 en production. Cause non établie, sans doute la table virtualisée qui mesure ses lignes après hydratation. |
| 2   | Démarrage à froid en production : 1,62 s sur la première requête après inactivité, 170 ms ensuite.                                                                                                                                                                 |
| 3   | Le premier octet d'un écran d'encadrement arrive en 0,65 s, contre 0,23 s pour un agent, avant comme après B1. `readSession` lit pourtant les mêmes deux lignes pour tous. Non expliqué.                                                                           |

## 5. Ce qui est vérifié comme sain

- **Petit centre :** affichage en 0,4 à 0,7 s, en local comme en production, téléphone bridé compris.
- **Production :**
  - documents compressés ;
  - morceaux statiques en brotli, `immutable` pour un an, servis depuis le cache de Vercel ;
  - premier octet entre 143 et 210 ms une fois la fonction chaude.
- **`next start` compresse aussi :** 5 134 Ko envoyés en 233 Ko de gzip.
  - Les mesures du navigateur ne voyaient pas l'en-tête `content-encoding` sur la navigation. Un client HTTP brut le voit.
- **Découpage du JavaScript :**
  - exceljs n'est dans aucun morceau du navigateur ; le classeur se construit en 73 ms côté serveur ;
  - TanStack (23 Ko gzip) n'est chargé que sur Disponibilités, et la virtualisation fonctionne ;
  - le client Supabase (66 Ko gzip) n'est chargé que par les pages de connexion ;
  - react-hook-form ne l'est que par la connexion et les écrans de gestion ;
  - les icônes sont découpées une à une.
- **Écrans d'agent :** calcul de 3,7 à 5,8 ms ; ICS 2,5 à 3 ms ; CSV 1,5 ms.
- **Changer d'écran dans les 30 s :** 0,4 s, sans nouvelle requête, puisque la mise en page n'est pas relue.
- **Disponibilités :** la table la plus grosse (31 515 lignes) se lisait déjà en 0,6 s avant B1 ; le plan que choisit la base pour sa règle n'a pas été examiné.
- **Notifications et journal :** volontairement plafonnés (50 et 200 lignes), ils restent légers quel que soit le volume.

## 6. Tests à ajouter

- **`database.test.ts`, avec B1 :** aucune règle de `public` ne doit appeler `private.is_member`, `can_manage` ou `can_administer`, vérifié dans `pg_policies`. Sans ce test, une règle ajoutée plus tard par copie d'une ancienne réintroduirait le coût sans que rien ne le signale.
- **`domain.test.ts`, avec C4 :**
  - `workloadAll` égale 80 appels à `workload` ;
  - `shiftsHeldAll` égale `shiftsHeld` agent par agent ;
  - les dates formatées sont identiques avec le formateur gardé.
- **`mapping.test.ts`, avec C1 :** le chargement de la seule campagne choisie, puis d'une autre à la demande ; et « Mois par mois » calculé côté serveur, égal à l'actuel.

## 7. Plan de travail ordonné

1. **B1 : une migration.** Les deux fonctions, les 36 `alter policy` écrits en clair, puis le test ci-dessus et les suites de base. À appliquer à la main dans l'éditeur SQL, comme les précédentes ; aucun code applicatif n'en dépend. C'est le seul point qui change l'ordre de grandeur : des écrans de 20 s à 1–2 s, et la disparition des erreurs de délai.
2. **C2 : sortir zod de la mise en page racine.** Changement local, sans effet fonctionnel.
3. **C3 et C4 : fournisseur mémorisé et calculs en un passage.** Les prototypes existent et sont vérifiés.
4. **C1 : ne charger que la campagne choisie.** C'est le chantier le plus large : il touche `loadState`, le fournisseur et Statistiques. C'est lui qui ramènerait la relecture d'un gestionnaire au niveau de celle d'un agent, et le blocage sur téléphone sous la seconde.

## 8. Vérifications exécutées

| Vérification                                                      | Résultat                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Écrans avant B1, ordinateur et téléphone                          | `mesures/ecrans-avant-*.json`                                                        |
| Gestes avant B1                                                   | Une série en échec (délai de requête dépassé, écran en erreur), une série complète   |
| Lectures PostgREST avant et après B1                              | `mesures/postgrest-avant.json`, `postgrest-apres.json` ; mêmes nombres de lignes     |
| Prototype B1 sur la pile locale                                   | 36 règles réécrites, plus aucune n'appelle les anciennes fonctions                   |
| Écrans et gestes après B1                                         | `mesures/ecrans-apres-*.json`, `interactions-apres.json` ; aucun échec de chargement |
| Suites de base du dépôt avec le prototype (PGlite)                | 243 sur 243                                                                          |
| Contre-épreuves : centres ouverts, droits d'encadrement à l'agent | 1 et 10 tests en échec, comme attendu                                                |
| Calculs, rendus et poids du JavaScript                            | 15 tests, `perf-code/mesures-*.json`                                                 |
| Compression d'un écran authentifié, `next start`                  | gzip, 5 134 → 233 Ko                                                                 |
| Production, lecture seule, compte de recette                      | `mesures/ecrans-production.json`                                                     |

Rien n'a été écrit dans le projet hébergé, hormis les ouvertures de session du compte de recette. Le prototype n'a été appliqué qu'à la pile locale.

**Non vérifié :**

- **La base hébergée à ce volume.** Le projet de recette n'a qu'une campagne, et la taille de sa machine n'a pas été relevée. Les temps y seraient vraisemblablement plus longs qu'ici, la limite de 8 s plus vite atteinte, et le gain de B1 du même ordre.
- **Plusieurs encadrants à la fois.** La charge simultanée n'a pas été mesurée.
- **L'effectif réel du centre pilote.** Le scénario est une projection : 80 agents après un an d'usage.
- **Un vrai téléphone.** Le bridage du processeur et du réseau est émulé.
- **Le gain de C2.** Il demande une construction modifiée.
- **Le décompte des rendus de C3.** Il vient de la lecture du code.
- **Les causes des points mineurs 1 et 3.**
