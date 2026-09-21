# Revue technique — 21 septembre 2026

Version examinée : commit **dbe6236** sur **main**, notifications poussées comprises.

Ce document part d'une revue extérieure de dix points. Chacun a été **contre-vérifié dans le code** avant d'être repris ici : les chemins, les policies, les lignes citées et les tailles de fichiers correspondaient tous à l'arbre réel — aucun constat inventé. Ce qui a été révisé, c'est l'ordre de gravité, pas les faits.

Quatre corrections ont été faites dans la foulée ; les six autres points restent ouverts avec, pour chacun, ce qui a été vérifié et ce que je ferais.

## Ce qui a été fait, ce qui reste

| #   | Constat                                        | Vérifié                | Gravité révisée             | État                                                            |
| --- | ---------------------------------------------- | ---------------------- | --------------------------- | --------------------------------------------------------------- |
| 7   | Publication sans verrou de ligne               | oui                    | **haute** (pilote imminent) | **Corrigé**, migration                                          |
| 4   | Erreurs de lecture de session confondues       | oui                    | moyenne                     | **Corrigé**                                                     |
| 2   | Excel hors périmètre de campagne               | oui                    | moyenne                     | **Corrigé**, 3 tests                                            |
| 3   | `loadState()` charge tout le centre            | oui                    | haute à moyen terme         | **Entamé** — lecture en parallèle ; découpage par écran à faire |
| —   | `entries_read` sans `auth.uid()`               | ajouté par cette revue | moyenne, surtout à l'avenir | Ouvert, à tester                                                |
| 1   | Policies larges sur les tables opérationnelles | oui, mais surévalué    | **basse** — décision métier | Ouvert, à trancher                                              |
| 5   | Écritures composées non atomiques              | oui                    | moyenne                     | Ouvert                                                          |
| 6   | Pas de relecture après un échec                | oui                    | moyenne, liée au 5          | Ouvert                                                          |
| 9   | Fuseau local dans les fonctions métier         | oui                    | basse en pratique           | Ouvert                                                          |
| 10  | En-têtes HTTP de production                    | oui                    | basse, sauf la CSP          | Ouvert                                                          |
| 8   | Fichiers monolithiques                         | oui                    | basse                       | Ouvert, après le pilote                                         |

---

## Corrigés

### 7 — Deux publications au même instant calculaient la même révision

`private.publish_schedule_shift()` lisait le créneau sans verrou, puis calculait `s.published_revision + 1`. Deux responsables qui publient ensemble lisaient la même révision : la clé primaire de `schedule_assignments` — `(créneau, agent, révision)` — arrêtait bien la seconde, mais par une violation de contrainte, c'est-à-dire par un message qu'on ne peut montrer à personne.

**Corrigé** par `supabase/migrations/20260921140000_verrou_publication.sql` : le créneau est lu `for update`. La seconde transaction attend la fin de la première, relit la révision publiée et republie par-dessus — ou bute sur un contrôle d'éligibilité, ce qui est un refus explicite. Le verrou ne porte que sur la ligne du créneau : deux publications sur deux créneaux différents ne s'attendent pas. Le corps de la fonction est repris à l'identique de `20260921090000`.

**Limite de la vérification :** PGlite est mono-connexion, la concurrence réelle n'est donc pas testable dans la suite. Ce que les tests garantissent, c'est que la fonction verrouillée passe **tous** les contrôles d'éligibilité existants — le corps recopié n'a rien perdu. La migration reste **à appliquer**.

### 4 — Une panne de base passait pour un compte non rattaché

`readSession()` lisait `profile.data` et `membership.data` sans regarder `error`. Or `maybeSingle()` échoue dans deux cas très différents : base injoignable, ou plusieurs lignes rendues — deux rattachements actifs, ce que la multi-organisation rendra possible. Les deux finissaient en « compte non rattaché », donc sur l'écran qui invite posément l'agent à attendre son gestionnaire. La panne ne laissait aucune trace, ni à l'écran ni dans les journaux.

**Corrigé** dans `src/lib/session.server.ts` : les deux lectures passent par `taken()`, le garde déjà utilisé par `loadState()`. Il journalise la cause côté serveur et lève un message générique ; « compte non rattaché » redevient ce qu'il aurait dû rester, une ligne réellement absente.

### 2 — Le classeur Excel contenait des agents que la campagne n'avait pas conviés

`buildWorkbook()` partait de `state.agents`, l'effectif actif du centre, là où les écrans avaient été corrigés pour ne compter que les participants — c'est la réserve A4 de l'audit du 19 septembre, restée ouverte. Sur un centre à plusieurs équipes, l'onglet Disponibilités présentait des agents jamais invités, avec un mois de « ? » qui se lit comme un défaut de réponse. Le taux de réponse, la feuille Qualifications et l'équité s'en trouvaient faussés dans le même mouvement.

**Corrigé** : `campaignAgents(state, campaign.id)`. Aucune feuille ne porte volontairement sur le centre entier — le fichier s'exporte depuis une campagne, il ne parle que d'elle. Une seule exception assumée : l'onglet Affectations cherche le nom dans l'effectif complet, pour qu'une affectation faite avant un départ garde son nom au lieu de disparaître de l'export.

Le défaut était invisible parce que le jeu d'essai convie tout le centre, donc les deux listes coïncidaient. **Trois tests** portent désormais sur une campagne qui ne convie que trois agents sur les douze du centre.

---

## Entamé

### 3 — `loadState()` charge tout le centre à chaque navigation

Le constat est exact et c'est bien le chantier principal. Deux précisions que la revue ne fait pas :

- la lecture page par page était **séquentielle** — `for(;;) await page(...)` — donc quarante pages, c'était quarante allers-retours en file indienne ;
- le volume ne dépend pas de « douze mois » mais de **toutes les campagnes jamais créées** : `campaignIds` les prend toutes, sans borne d'ancienneté.

**Fait maintenant : les pages d'une même table partent ensemble.** Le compte exact, déjà demandé pour savoir quand s'arrêter, dit aussi d'avance où commence chaque page. Six en vol à la fois — au-delà on n'accélère plus, et on occupe des connexions que les autres tables attendent. Les quarante pages d'un centre de cinquante agents passent ainsi de quarante requêtes en file à sept vagues. Rien ne change de ce qui est lu : mêmes lignes, même ordre.

Deux cas gardent la lecture séquentielle, parce qu'on ne peut pas y prévoir les plages : l'absence de compte, et une première page écourtée — signe que le serveur plafonne plus bas que ce qu'on demande. Et si le total final ne tombe pas juste, la lecture **repart entièrement à la file** : les plages étant calculées d'avance, une page servie courte laisserait un trou au milieu, et un trou muet est exactement ce que ce module existe pour empêcher. Quatre tests couvrent le parallélisme, son plafond, ce repli et l'échec d'une page.

**Ce qui reste, et pourquoi ce n'est pas un raccourci.** Le geste évident — ne charger que la campagne sélectionnée — ne tient pas en l'état, pour deux raisons précises :

1. **L'écran des statistiques lit toutes les campagnes** (`state.campaigns.reduce(...)` sur les entrées et les affectations). Le restreindre le viderait silencieusement.
2. **La campagne sélectionnée est un état client** : le sélecteur ne navigue pas, il change un `useState`. Le serveur ne sait donc pas laquelle est choisie.

Le découpage réel suppose donc de faire passer la sélection par l'URL, de scinder `loadState()` par écran, et de donner aux statistiques des agrégats SQL au lieu du détail. C'est une transformation à faire en une fois, relisible, pas à l'occasion d'un correctif. L'architecture cible proposée par la revue est la bonne.

---

## Ouverts

### Le point que la revue a manqué — `entries_read` ne contient aucun `auth.uid()`

```sql
create policy entries_read on public.availability_entries for select to authenticated using (
  exists (select 1 from public.campaign_participants p
          where p.campaign_id = availability_entries.campaign_id
            and p.user_id = availability_entries.user_id)
);
```

L'isolation ne vient pas de cette policy mais de celle de `campaign_participants`, en cascade : un agent ne voit que sa propre ligne de participation, donc l'`exists()` ne réussit que pour ses propres disponibilités. C'est juste, et même élégant. C'est aussi **fragile** : le jour où quelqu'un élargit la lecture des participants — « que les agents voient qui participe à la campagne » —, il publie d'un coup les disponibilités de tout le centre sans qu'une seule ligne de `availability_entries` ait bougé.

**À faire :** un commentaire dans la migration disant que cette policy dépend de l'autre, et un test qui échoue si l'agent B lit une disponibilité de l'agent A. Le test n'existe pas aujourd'hui : la suite couvre l'isolation entre centres, pas entre agents d'un même centre.

### 1 — Les policies larges : une décision, pas un trou

Le constat est exact — `staffing_requirements`, `staffing_requirement_qualifications`, `schedules`, `schedule_shifts` et `user_qualifications` s'ouvrent à `private.is_member()`. Mais la conclusion est trop forte, parce que tout ce qui est personnel est **déjà** strictement cloisonné :

| Table                  | Ce qu'un agent peut lire                                 |
| ---------------------- | -------------------------------------------------------- |
| `profiles`             | la sienne ; l'encadrement voit celles qu'il gère         |
| `memberships`          | la sienne                                                |
| `availability_entries` | les siennes                                              |
| `schedule_assignments` | ses gardes **publiées** — le brouillon lui est invisible |
| `notifications`        | les siennes                                              |

Restent ouvertes à tout membre : l'organisation, les équipes, les campagnes, les plannings, les créneaux et les besoins — **des contenants, des dates et des effectifs, sans aucun nom** — plus `user_qualifications`, seule table à parler des personnes. La question n'est donc pas le moindre privilège en général, c'est : _un agent a-t-il le droit de savoir qui est qualifié pour quoi dans son centre ?_ Dans une caserne, c'est affiché au mur. **À trancher avec le porteur du projet**, et à écrire dans les décisions fonctionnelles plutôt qu'à resserrer par réflexe.

### 5 et 6 — Écritures composées, et l'écran qui les suit

Exact pour `writeAvailability()` (mise à jour puis insertion) et `writeMember()` (profil, rattachement, qualifications retirées, qualifications ajoutées — quatre requêtes). Une erreur au dernier étage laisse les précédents enregistrés. Le lot de besoins le documente déjà honnêtement : chaque créneau est atomique, le lot ne l'est pas.

Sur le remède proposé au 6 — rafraîchir pour les commandes « connues comme potentiellement partielles » —, je ferais autrement : maintenir une telle liste est exactement le genre de liste qui se désynchronise du code qu'elle décrit. **Rafraîchir après tout échec** coûte une lecture et supprime la classe entière d'écrans périmés. Le vrai remède reste le 5 : des fonctions PostgreSQL transactionnelles, comme `create_campaign()` et `set_staffing_requirement()`.

### 9 — Le fuseau

Exact : `localDate()` et `localMonth()` lisent l'heure de la machine, alors que la règle métier dit Europe/Paris et que `date-fns-tz` est déjà installé. La conséquence concrète est mince — un centre français, des agents français — mais elle existe : un agent en déplacement à l'étranger peut voir une campagne ouverte ou close à contretemps. À normaliser, sans urgence.

### 10 — Les en-têtes

`Permissions-Policy` et `Strict-Transport-Security` sont gratuits et à poser. La **CSP est le seul point de cette revue capable de casser la production** — Next injecte styles et scripts en ligne : à déployer en `Content-Security-Policy-Report-Only` d'abord, et à ne resserrer qu'après lecture des rapports.

### 8 — Les fichiers qui grossissent

Les tailles citées sont exactes. `globals.css` (4 249 lignes) est celui qui gêne vraiment, et `tests/database.test.ts` se scinde sans risque par domaine. En revanche je ne lancerais pas l'arborescence `features/` maintenant : c'est un déplacement massif, sans bug à la clé, sur un projet qui n'a pas encore servi une seule garde. Après le pilote.

---

## Ce que cette revue ne couvre pas

À dire, pour que personne ne la prenne pour un état des lieux complet :

- **Les notifications poussées** ne sont pas examinées, alors que les tailles de fichiers citées montrent que la revue a été faite après leur livraison. Le code le plus récent n'est donc pas relu.
- **L'avertissement de construction `middleware` → `proxy`**, déprécié en Next 16, n'est pas mentionné.
- **La concurrence hors publication** : deux gestionnaires qui modifient le même brouillon, dernier écrivain gagnant, sans avertissement. Le verrou du 7 ne traite que la publication.
- **Sauvegardes, conservation et information des agents**, que la recette tient pour bloquants avant mise en service.
- **Rien n'est dit des tests à ajouter** : chacun des dix points est pourtant testable, et quatre le sont désormais.

## Vérifications exécutées

196 tests unitaires et de base — dont 114 sur PostgreSQL embarqué —, formatage, lint, types, construction, et 22 parcours navigateur passés avec un compte d'essai. Les six tests ajoutés portent sur le classeur d'une campagne partielle et sur la lecture en parallèle — son plafond de six pages en vol et son repli à la file compris.

**Non vérifié :** l'application de la migration `20260921140000` sur le projet hébergé, la concurrence réelle de deux publications simultanées, et le comportement de la lecture en parallèle sous la latence d'un vrai réseau.
