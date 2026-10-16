# Prise en main et ergonomie — 16 octobre 2026

Version examinée : commit **d7a5e76** sur **main** (« audit B1 corrigé »). La copie de travail ne modifie aucun fichier de code : seuls le README et des documents non suivis diffèrent, dont l'analyse et le guide des gestionnaires du 8 octobre. Tout ce qui a servi à cette revue est dans `.local/audit-20261016/` (dossier ignoré par git).

**En une phrase :** **côté agent, oui, l'application se prend en main seule** : on active son compte en trois touches, l'accueil montre la seule chose à faire, la prochaine garde se lit sans chercher et le désistement est expliqué sans ambiguïté. **Côté encadrement, elle est utilisable mais pas intuitive** : elle s'apprend avec le guide du 8 octobre ou une démonstration. La publication se fait créneau par créneau, les désistements sont peu visibles sur téléphone, un même objet porte plusieurs noms, et les gestionnaires, qui participent aux campagnes, n'ont aucun chemin vers leurs propres disponibilités. Le premier jour d'un nouveau centre, enfin, l'administrateur est bloqué tant qu'un script SQL n'a pas été exécuté pour lui.

## Suivi des correctifs — 16 octobre 2026, le soir

Ce suivi prévaut sur l'état des chapitres 3 et 4, conservés tels quels comme constat initial.

| Point          | Correctif                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Vérification                                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C2             | **Avant le geste :** la boîte de saisie d'une réponse validée prévient « Votre réponse est validée : après ce changement, il faudra la valider de nouveau. » **Après :** le message dit « Disponibilités modifiées. Votre réponse est à valider de nouveau. » ; même annonce après l'application du modèle habituel. `run()` accepte pour cela un message de réussite propre à l'écran (`provider.tsx`). **Sur téléphone et tablette** (jusqu'à 1000 px, là où la validation passe sous le calendrier), une barre « 31 / 31 jours renseignés — Valider » colle au bas de l'écran dès le mois complet et non validé, au-dessus de la barre de navigation ; elle reprend sa place en fin de page, et le message de réussite passe au-dessus d'elle. | Dans Chromium, sur la pile locale (`.local/audit-20261016/correctifs/correctifs.spec.ts`) : annonce avant et après, absente quand rien n'était validé ; barre au-dessus de la navigation en haut de page, après le dernier bloc en fin de page, à 12 px du bas sur tablette, absente sur ordinateur ; message au-dessus de la barre. |
| C4 (en partie) | Un jour vide, la saisie rapide et la sélection multiple s'ouvrent **sans disponibilité cochée** ; « Enregistrer » reste inactif et le dit : « Choisissez d'abord une disponibilité. » Un jour déjà renseigné s'ouvre toujours sur sa valeur. Pour un seul jour ouvert depuis le calendrier, l'avertissement « 1 jour déjà renseigné sera remplacé », qui n'apprenait rien, ne s'affiche plus ; il reste pour la saisie rapide et la sélection multiple. Les trois autres points de C4 (quatre façons de saisir, « seulement les jours non renseignés », le bouton grisé du modèle) restent ouverts.                                                                                                                                               | Même fichier : rien de coché, bouton inactif et expliqué, puis actif après un choix, dans les trois cas.                                                                                                                                                                                                                             |

**Contre-épreuve :** `correctifs/contre-epreuve.spec.ts` mesure séparément les cinq attentes. Sur le code de `d7a5e76`, reconstruit pour l'occasion, les cinq échouent ; sur le code corrigé, toutes passent.

**Vérifications après correction :** formatage, lint (l'avertissement connu de TanStack Table), types, tests en Europe/Paris et en UTC, construction. `docs/RECETTE.md` §3.2 et §3.3 décrivent le nouveau comportement.

**Non rejoué :** un vrai téléphone, dont l'encoche (la barre tient compte de `safe-area-inset-bottom` comme la navigation, sans que ce soit vérifié sur un iPhone) ; la lecture par VoiceOver ou TalkBack.

### B2 — décision C6 du porteur du projet : l'encadrement ne prend pas de garde

« Les gestionnaires ne prennent pas de garde. Ils ne font que gérer les effectifs. » La question C6 portait sur l'encadrement entier, administratrice et gestionnaire compris (analyse du 5 octobre) : la décision vaut pour les deux rôles, qui ont le même menu. Elle est consignée dans `DECISIONS_FONCTIONNELLES.md`.

| Où     | Correctif                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Vérification                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base   | Migration `20261016150000_encadrement_hors_campagnes.sql`. Une règle, `private.takes_shifts(rôle)`, appliquée par la création d'une campagne, l'arrivée en cours de campagne — désormais aussi le retour au rôle d'agent —, le déverrouillage et la relance. Le rattrapage retire l'encadrement des campagnes non closes où il n'a rien saisi ; qui a saisi reste inscrit, avec ses saisies, et la migration le signale. Les campagnes closes ne bougent pas. Le script de la première campagne écrit la même condition en clair. | `database.test.ts` : les quatre chemins, administrateur et gestionnaire exclus, agent inscrit ; retour au rôle d'agent ; agent promu gardé inscrit, saisies intactes, plus relancé ; rattrapage sur une base dans l'état d'avant ; gardes d'application. Ces tests échouent sans la migration. Sur la pile locale : appliquée telle qu'elle sera collée, 4 inscriptions retirées, 1 gardée (un gestionnaire qui avait saisi), second passage refusé. |
| Écrans | `campaignAgents()` et la liste des disponibles ne comptent que les agents (`takesShifts`, `domain.ts`), ce qui couvre aussi les campagnes d'avant la décision. La répartition des gardes du planning part des agents de la campagne. Accueil, Mes disponibilités et Mon planning renvoient l'encadrement au tableau de bord ; son menu gagne « Mon profil », pour les notifications de l'appareil.                                                                                                                                | `mapping.test.ts` : l'administrateur inscrit, validé et disponible d'avant la décision n'est ni compté ni proposé (échoue sans le changement). Dans Chromium (`correctifs/c6.spec.ts`) : renvois au tableau de bord, « Mon profil » au menu, matrice et répartition sans l'encadrement, tableau de bord à « 0 / 10 » agents, écrans d'un agent intacts.                                                                                              |

### C3 et C4 — les désistements visibles, deux façons de saisir

| Point | Correctif                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Vérification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3    | « Demandes » devient **« Désistements »** : titre, menu, messages ; l'adresse reste `/demandes`, celle des emails déjà partis. L'entrée quitte « Administration » pour le menu principal, en quatrième place : sur téléphone, elle prend dans la barre du bas la place de « Besoins », qui se fixent une fois par mois. Sa pastille suit l'entrée, dans le menu et dans la barre du bas, plutôt que sur ☰ : visible sans rien ouvrir, elle n'a pas à être répétée sur le bouton du menu. Le tableau de bord annonce « N désistements en attente » avec un lien « Examiner ». Chaque notification porte le lien de son email (`notificationTargets`, désormais dans `domain.ts`, partagé avec `email.ts`), et l'ouvrir la marque comme lue. La décision dit « Désistement accepté » ou « refusé », et non plus « tranché ».                                                                                                                                                                                                                                                       | `email.test.ts` : chaque genre de message a son écran. Dans Chromium (`correctifs/c3c4.spec.ts`), un agent signale un désistement, puis l'administrateur voit la pastille dans le menu principal et rien sous « Administration » ; l'annonce du tableau de bord le mène à l'écran ; la notification « Examiner le désistement » ouvre l'écran et passe en lu ; la pastille est dans la barre du bas sur téléphone ; « Refuser » affiche « Désistement refusé. ».                                                                                                                                                                                                                                                                                                                                                                                           |
| C4    | Deux façons de saisir au lieu de quatre : toucher un jour, ou la **saisie rapide**, en deux onglets. **« Période »** pose une même valeur sur une période. **« Semaine type »** pose une valeur par jour de semaine sur une période ; elle réunit l'ancien onglet « Jours de la semaine » et le panneau « Ma disponibilité habituelle », retiré, et part de la semaine habituelle enregistrée. « Garder comme ma semaine habituelle », coché d'office, l'enregistre en l'appliquant : plus de bouton grisé. La « Sélection multiple » est retirée : une période ou une semaine type couvre ses usages. Dans les deux onglets, « Ne remplir que les jours non renseignés », coché d'office, épargne ce qui existe ; décoché, la boîte compte les jours remplacés. Ce qui manque pour enregistrer est dit sous le bouton. Les choix de la semaine type mesurent 44 × 40 px. L'accueil mène droit à la semaine type. La semaine s'écrit en une transaction, par la nouvelle fonction `apply_week()` (migration `20261016200000_semaine_type.sql`, à appliquer avant le déploiement). | `database.test.ts` : jours de semaine et période respectés, jours renseignés épargnés ou remplacés à la demande, période ramenée à la campagne, réponse remise à valider, refus d'une semaine mal formée, d'une période à l'envers, d'une campagne close, d'un non-participant, d'un visiteur ; gardes d'application. Ces tests échouent sans la migration. `commands.test.ts` : semaine gardée sur sept jours puis appliquée d'un seul appel, ou appliquée seule. Sur la pile locale : migration appliquée, second passage refusé. Dans Chromium : plus de sélection multiple ni de panneau ; un jour à la main, puis « Période » qui l'épargne (« 30 jours seront renseignés ») ; « Semaine type » qui ne trouve rien à compléter tant que l'option est cochée, puis remplace les 4 lundis et garde la semaine ; l'accueil rouvre la semaine préremplie. |

**Vérifications après correction :** formatage, lint (l'avertissement connu de TanStack Table), types, 503 tests en Europe/Paris et 256 en UTC. `docs/RECETTE.md` §3.1 (la semaine type) et §4.5 (les désistements) décrivent le nouveau comportement.

**À mettre à jour hors du dépôt :** le guide des gestionnaires du 8 octobre parle de l'écran « Demandes ».

## Périmètre et niveau de preuve

- **Les parcours, réellement joués.** Pile Supabase locale d'audit (centre « CIS Audit », 8 membres, une campagne de décembre ouverte et une de novembre publiée), application construite par `next build`, Chromium en français, à l'heure de Paris. Profils :
  - téléphone : 390 × 844, tactile ;
  - ordinateur : 1440 × 900.

  Cinq parcours (`parcours/parcours.spec.ts`), 70 captures, chacune avec son arbre accessible, c'est-à-dire le texte exact affiché (`parcours/captures/`) :
  - **A**, un agent invité : de l'email à ses premiers écrans, sur téléphone ;
  - **B**, un agent déjà en place, sur téléphone ;
  - **C**, l'administrateur d'un centre en activité, sur ordinateur ;
  - **D**, le même, sur téléphone ;
  - **E**, l'administrateur d'un centre tout neuf, le premier jour.

  S'y ajoutent la mesure des cibles tactiles (`cibles.spec.ts`) et l'accès d'un encadrant à ses écrans personnels (`encadrant-perso.spec.ts`).

- **Une relecture du code**, conduite en parallèle sur les sept angles habituels : navigation, nombre d'étapes, guidage, messages, vocabulaire, cohérence, accessibilité. Chaque constat repris ici a été revérifié au fichier et à la ligne, ou vu à l'écran.
- **Le guide des gestionnaires du 8 octobre** (`output/docx/DispoSP_Guide_gestionnaires_2026-10-08.docx`, dix pages) : seuls ses titres ont été relus, pour savoir ce qu'il couvre.

**Limite principale :** c'est une revue d'expert, pas un test avec des utilisateurs. Aucun sapeur-pompier n'a tenu le téléphone. Le chapitre 7 propose un test court à faire pendant le pilote : lui seul dira si ce qui est jugé clair ici l'est pour eux.

## 1. Ce que vit un agent

| Tâche                                  | Étapes                        | Vu à l'écran |
| -------------------------------------- | ----------------------------- | ------------ |
| Activer son compte depuis l'email      | 3 touches, 2 saisies          | A1 à A4      |
| Remplir un mois uniforme, puis valider | 4 touches, plus la validation | A5, A8       |
| Un jour différent                      | 3 touches par jour            | A6, A7       |
| Voir sa prochaine garde                | 0 : elle est sur l'accueil    | B1           |
| Se désister                            | 3 touches                     | B2, B3       |

**Ce qui marche, et qui fait l'essentiel de la prise en main :**

- **L'accueil dit quoi faire.** On y trouve, dans l'ordre :
  - « Campagne en cours », avec l'anneau « 0 / 31 jours renseignés » ;
  - « Réponses attendues jusqu'au 20 novembre » ;
  - un seul bouton principal, « Renseigner mes disponibilités » (capture A4).
- **La saisie se comprend sans légende.**
  - Chaque choix porte sa lettre, son nom et ses horaires : J « 8 h – 20 h », N, 24 h, X.
  - La saisie rapide annonce ce qu'elle va faire avant d'écrire : « 31 jours sélectionnés · Du mardi 1 décembre au jeudi 31 décembre ».
  - Elle prévient avant d'écraser : « 1 jour déjà renseigné sera remplacé » (A8).
- **La validation est expliquée.**
  - « La saisie ne vaut pas validation. »
  - Le bouton reste éteint tant que le mois n'est pas complet, avec la raison à côté : « 31 jours restent à renseigner. Pensez à indiquer vos indisponibilités. »
- **Le désistement ne laisse aucun malentendu :** « Vous restez attendu sur cette garde tant que votre encadrement n'a pas répondu. Un désistement n'est pas une annulation. » (B3).
- **Les écrans vides disent ce qui viendra**, et renvoient à l'action utile : « Aucune garde publiée à venir. Vos affectations apparaîtront ici après publication par le gestionnaire », puis le bouton « Vérifier mes disponibilités » (A9).

Les défauts côté agent sont décrits en C2 et C4, et dans les points mineurs.

## 2. Ce que vit l'encadrement

| Tâche                     | Étapes                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Inviter un agent          | 3 clics et la saisie                                                                         |
| Ouvrir une campagne       | 3 clics et un nom à taper                                                                    |
| Fixer les besoins du mois | 4 clics : la boîte arrive préremplie                                                         |
| Affecter une garde        | navigation jusqu'au créneau, puis « + » par agent                                            |
| **Publier le mois**       | **2 clics par créneau, soit 124 clics pour les 62 créneaux de décembre**, plus la navigation |
| Trancher un désistement   | 3 clics, plus 5 pour remplacer et republier                                                  |

Les écrans d'encadrement sont propres et cohérents entre eux : tableau de bord à indicateurs, carte de couverture lisible sans les couleurs, planning en trois colonnes (disponibles, affectés, besoins). Le planning dit pourquoi une publication est bloquée et qui retirer. Chaque confirmation nomme son geste.

Mais le parcours ne se devine pas : l'ordre du travail n'est écrit nulle part dans l'application (C5). Le guide du 8 octobre le donne, chapitre par chapitre ; c'est aujourd'hui lui qui fait la prise en main de l'encadrement.

## 3. Constats bloquants pour une prise en main

### B1 — Le premier jour, l'administrateur d'un nouveau centre ne peut rien faire

**Constat :** un centre sans campagne ouvre tous les écrans sur « Aucune campagne ouverte » (capture E1). Le message dit : « Demandez à l'administrateur du projet de l'ouvrir : il exécute pour cela le script supabase/provisioning/premiere-campagne.sql dans l'éditeur SQL de Supabase. » (`src/components/account.tsx:63`).

L'administrateur ne peut donc ni inviter ses agents, ni régler ses horaires, ni ouvrir la campagne lui-même. Et la seule consigne qu'il reçoit est un chemin de fichier destiné à un informaticien.

Sur ordinateur, s'ajoute un défaut d'affichage : la carte occupe la moitié gauche de l'écran, la droite reste vide. Ces écrans reprennent la grille à deux colonnes de la page de connexion (`globals.css:3978-3983`) sans son panneau de marque.

**Portée :** nulle pour le centre pilote, que le porteur du projet provisionne lui-même. Bloquante dès qu'un deuxième centre devra démarrer sans lui.

**Proposition :** que l'écran Campagnes et Agents & équipes s'ouvrent sans campagne, ou que cet écran propose directement « Ouvrir la première campagne ». Une campagne s'ouvre déjà depuis l'application ensuite (`create_campaign`).

### B2 — Les encadrants participent aux campagnes, mais aucun menu ne mène à leurs disponibilités

**Constat :** la création d'une campagne y inscrit tous les membres actifs de l'équipe, encadrants compris (`20260918151529_atomic_campaign_creation.sql:67-70`). Pourtant, le menu de l'encadrement ne contient ni « Mes disponibilités », ni « Mon planning », ni « Mon profil » (`src/components/shell.tsx:32-47`).

Ces écrans existent et s'ouvrent quand on tape leur adresse (capture F1), mais aucun lien n'y mène. Les conséquences :

- le tableau de bord compte l'encadrant parmi les réponses à valider (capture C-disponibilites, lignes « Adèle Admin » et « Gaston Gestion » à « À valider ») ;
- la relance lui écrit « Renseigner mes disponibilités » ;
- la fenêtre des notifications le renvoie vers « Mon profil » (`pwa.tsx:479-480`), qu'il n'a pas.

**Lien avec une décision ouverte :** c'est la question C6 encore ouverte (les encadrants prennent-ils des gardes ?).

- **Si oui :** une rubrique « Mon espace » au menu de l'encadrement suffit.
- **Si non :** il faut les retirer des participants, côté base.

## 4. Constats gênants

### C1 — Publier un mois demande 124 clics, et rien ne dit ce qui reste à publier

La publication se fait créneau par créneau : c'est une décision écrite (`docs/DECISIONS_FONCTIONNELLES.md:96`), et elle a ses raisons, puisque chaque garde est contrôlée avant de partir. Son coût pour l'encadrement :

- « Publier ce créneau », puis « Confirmer la publication », pour chacun des 62 créneaux d'un mois (`planning.tsx:399`, `:496-516`) ;
- aucun compteur « créneaux publiés / 62 » : le tableau de bord n'en a pas, et le panneau « Étapes suivantes » se borne à dire « Publier les créneaux couverts » (`dashboard.tsx:465`) ;
- chaque publication envoie à chaque agent affecté une notification et un email identiques, « Votre planning a été publié », sans date (`20260927090000_correctifs_bilan.sql:205-208`). Un agent de huit gardes en reçoit huit.

**Proposition, sans revenir sur la décision :**

- un bouton « Publier les N créneaux prêts » qui appelle la même publication créneau par créneau et liste ceux qu'elle a refusés, avec leur motif ;
- un compteur de créneaux publiés ;
- un avis par agent et par lot, qui donne ses dates.

### C2 — Un agent peut croire avoir fini alors que sa réponse n'est plus validée

- **La validation est en bas de page.** Sur téléphone, « Valider mes disponibilités » arrive après le calendrier et la légende (capture A5, page entière) : il faut penser à défiler.
- **Modifier un jour déjà validé annule la validation, sans le dire au moment du geste.**
  - La base remet `validated_at` à vide à chaque changement (`0001_foundation.sql:163`).
  - La boîte de saisie dit seulement « Elle sera enregistrée en brouillon jusqu'à votre validation » (`availability.tsx:344`).
  - Le message de réussite dit « Disponibilités modifiées » (`domain.ts:794`).

  L'agent qui corrige un jour la veille de la clôture sort de l'application persuadé d'avoir répondu. Le tableau de bord, lui, le compte parmi les réponses manquantes.

**Proposition :**

- sur téléphone, une barre fixe « 31 / 31 — Valider mes disponibilités » ;
- quand la réponse était validée, un message explicite : « Votre réponse est à valider de nouveau ».

### C3 — Les désistements se voient mal côté encadrement, surtout sur téléphone

- **L'écran s'appelle « Demandes »** et se range sous « ADMINISTRATION » (`shell.tsx:42-47`), alors qu'il ne traite que des désistements. C'est le travail courant de l'encadrement, pas de l'administration.
- **Sur téléphone, il manque partout :**
  - absent de la barre du bas, qui garde Tableau de bord, Disponibilités, Planning et Besoins (capture D-planning) ;
  - sa pastille n'existe que dans le menu latéral (`shell.tsx:146-148`) ; le bouton ☰ n'en porte aucune (`shell.tsx:171-173`).
- **Le tableau de bord n'en parle pas :** aucune lecture des désistements dans `dashboard.tsx`.
- **Les notifications de l'application ne mènent nulle part.** Chacune n'offre que « Marquer comme lu » (`notifications.tsx:40-60`). L'email, lui, ouvre le bon écran. La notification du téléphone mène à l'écran Notifications (`push.ts:49`), où elle s'arrêtait donc. _Rectifié le 16 octobre au soir : la première version de ce rapport disait qu'elle ouvrait le bon écran._

**Proposition :**

- renommer l'écran « Désistements » et le remonter dans le menu principal ;
- mettre la pastille sur ☰ et une carte « N désistements en attente » au tableau de bord ;
- rendre les notifications cliquables.

### C4 — Plusieurs façons de saisir, et des écrasements faciles

L'écran « Mes disponibilités » offre quatre manières de saisir :

- toucher un jour ;
- « Sélection multiple » ;
- « Saisie rapide », par période ou par jours de la semaine ;
- « Ma disponibilité habituelle », plus bas, qui refait la saisie par jours de la semaine (capture A5, page entière).

Pour un débutant, c'est trois de trop, et elles écrasent toutes ce qui existe. Il n'y a pas de « seulement les jours non renseignés ».

- **Un jour vide s'ouvre avec « Jour » déjà choisi** (`availability.tsx:96`, capture A6). Toucher « Enregistrer la disponibilité » sans rien choisir enregistre donc une disponibilité de jour.
- **« Appliquer à décembre 2026 » reste grisé sans explication** tant que le modèle n'est pas enregistré (`availability.tsx:300`). La recette elle-même le signale comme un piège.

**Proposition :**

- garder la saisie rapide comme chemin principal, et y loger le modèle habituel ;
- ouvrir un jour vide sans choix présélectionné ;
- ajouter l'option « seulement les jours non renseignés ».

### C5 — L'encadrement n'est pas guidé, et le vocabulaire change d'un écran à l'autre

**Rien ne suit l'avancement réel.** Le panneau « Étapes suivantes » du tableau de bord est figé (`dashboard.tsx:448-475`). Il compte deux étapes, « Compléter les affectations » et « Publier les créneaux couverts », et ignore l'ouverture de la campagne, les besoins, la relance et les désistements. Il n'y a pas d'aide en ligne.

Le Planning s'ouvre sur le 15 du mois (`planning.tsx:52`). Un créneau sans volontaire dit « Aucune disponibilité validée pour ce créneau » sans proposer la relance.

**Un même objet porte plusieurs noms :**

| Notion                    | Noms rencontrés                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La garde                  | « créneau » et « garde » sur le même écran : « Publier ce créneau » ouvre « Publier cette garde » (`planning.tsx:399`, `:496`)                                                                            |
| L'état d'une campagne     | « Fermée », « Verrouiller la saisie », « close », « clôture ». Une campagne affichée « Fermée » propose encore « Verrouiller la saisie » (`management.tsx:113-114`, `:181`)                               |
| Qui décide, vu de l'agent | « le responsable » (A6), « le gestionnaire » (A4, A9), « votre encadrement » (B3)                                                                                                                         |
| Un jour non renseigné     | « — » dans le calendrier de l'agent, « ? » dans sa légende et dans la matrice de l'encadrement                                                                                                            |
| La conduite poids lourd   | « Conducteur PL », la qualification proposée dans les besoins par défaut, et « PL », la conduite saisie à l'invitation : deux minima distincts pour la même chose. C'est la question ouverte du 7 octobre |

**Proposition :**

- des étapes qui suivent l'état réel : campagne, besoins, relance, affectations, publication, désistements, chacune avec son compteur et son lien ;
- un mot par notion, consigné dans `DECISIONS_FONCTIONNELLES.md`.

### C6 — Les formulaires de l'encadrement ne disent pas quel champ corriger

Dans « Inviter un agent », rien n'est vérifié à l'écran. Une adresse mal tapée ou un nom vide reviennent avec « La demande est incomplète ou mal formée. » (`src/app/actions.ts:52`), sans dire quel champ corriger.

Deux autres messages ne disent pas quoi faire :

- **Une invitation déjà en attente pour la même adresse** donne « Cet enregistrement existe déjà. » (`command-errors.ts:126`). Le message ne dit pas qu'on peut la renvoyer.
- **Deux « + » trop rapides au planning** donnent une erreur (`provider.tsx:171-173`), alors que le geste est normal.

## 5. Points mineurs

| #   | Constat                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Sur téléphone, la carte « Prochaine garde dans 19 jours » serre trois colonnes et casse son titre sur quatre lignes (capture B2).                                                                                                                                                                                                                                                    |
| 2   | Le titre de la boîte « Je ne peux plus tenir cette garde » passe sous la croix de fermeture (capture B3).                                                                                                                                                                                                                                                                            |
| 3   | Cibles tactiles mesurées sur téléphone (`cibles.txt`). Toutes dépassent le minimum WCAG 2.2 AA (24 px), mais beaucoup restent sous les 44 px recommandés : sélecteur de mois 26 px de haut, « Voir tout » 24 px, « Je ne peux plus » 31 px, cloche 34 px, boutons du modèle habituel 30 × 26 px (`globals.css:4329-4331`). Libellés de la barre du bas en 9 px (`globals.css:3752`). |
| 4   | Le sélecteur de mois reste affiché sur les écrans où il ne change rien : notifications, profil, agents, demandes, historique, paramètres. Sur « Mon planning », il affiche « Décembre 2026 » alors que la prochaine garde de l'agent tombe en novembre (capture B2).                                                                                                                 |
| 5   | L'agent lit « Version 3 · publiée le 5 octobre » (B2), et l'encadrement « Réaffecté depuis : la version 3, publiée le 5 octobre, le nomme de nouveau. » (C-demandes).                                                                                                                                                                                                                |
| 6   | Tournures techniques : « la base refuse de le publier » (Besoins), « Supabase limite le nombre d'emails envoyés par heure » (`commands.server.ts:462`), « conservées en base » (page d'erreur).                                                                                                                                                                                      |
| 7   | Dès le premier jour, l'accueil affiche en rouge « 31 jours restants à renseigner », à 35 jours de la date limite (A4). L'orange suffirait, le rouge serait réservé à la dernière semaine.                                                                                                                                                                                            |
| 8   | L'activation enchaîne deux écrans tous deux titrés « Activer mon compte » (A2, A3). La règle des 8 caractères n'apparaît qu'après une erreur.                                                                                                                                                                                                                                        |
| 9   | « Disponibilités » désigne deux écrans selon le rôle. Le titre « ADMINISTRATION » s'affiche aussi pour un gestionnaire.                                                                                                                                                                                                                                                              |
| 10  | Le message de réussite « Désistement tranché. » ne dit pas si la demande a été acceptée ou refusée (`domain.ts:802`).                                                                                                                                                                                                                                                                |

## 6. Ce qui est vérifié comme sain

- **Les refus de la base sont tous traduits en français et disent quoi faire**, par exemple « Renseignez chaque jour du mois avant de valider votre réponse. ».
  - Les erreurs restent affichées jusqu'à ce qu'on les ferme ; les réussites disparaissent seules.
  - Les messages sont annoncés aux lecteurs d'écran.
- **Les confirmations nomment leur geste**, jamais « OK », et disent la conséquence.
- **Le lien d'activation résiste aux analyseurs de messagerie** grâce à la page « Continuer ». Un lien expiré est expliqué, avec la marche à suivre.
- **La couleur ne porte jamais seule une information importante** : lettres J, N, 24, X dans les cases, signes ✓ = − Q sur la carte de couverture, motif écrit d'une affectation refusée.
- **La question des notifications n'est posée qu'une fois.** Elle a son « Non merci ». Si l'agent les a bloquées, son profil dit comment les rouvrir sur Android et sur iPhone.
- **Un agent qui tape l'adresse d'un écran d'encadrement** est renvoyé vers son espace, avec une explication.

## 7. Le test à faire pendant le pilote

Cette revue ne remplace pas trente minutes avec de vrais utilisateurs. Proposition :

- **Qui :** cinq agents, sur leur propre téléphone, et deux encadrants sur leur poste.
- **Comment :** aucune explication préalable. On observe sans aider, et la personne dit à voix haute ce qu'elle pense.
- **Agents :**
  1. Activer son compte depuis l'email.
  2. Remplir décembre et valider.
  3. Corriger un jour et revalider.
  4. Dire quand tombe sa prochaine garde.
  5. Se désister d'une garde.
- **Encadrants :**
  1. Inviter un agent.
  2. Fixer les besoins de décembre.
  3. Affecter et publier une semaine.
  4. Trancher un désistement et remplacer l'agent.
- **Ce qu'on note :** réussite sans aide, temps passé, hésitations et erreurs, et chaque mot qu'il a fallu expliquer.
- **Ce qu'on vérifie en priorité :** C2 (la revalidation oubliée), C3 (le désistement repéré) et C4 (le « Jour » préchoisi).

## 8. Plan proposé

Par ordre de rapport entre le gain pour un débutant et le travail demandé :

1. **C2 :** barre de validation fixe sur téléphone, et message « à valider de nouveau ». Petit changement, risque réel pour la qualité des réponses.
2. **C4 :** ne plus préchoisir « Jour » sur un jour vide, et expliquer le bouton grisé du modèle.
3. **C3 :** renommer « Demandes » en « Désistements », pastille sur ☰ et au tableau de bord, notifications cliquables.
4. **B2 :** trancher la décision C6, puis ajouter « Mon espace » au menu de l'encadrement ou retirer les encadrants des participants.
5. **C6 :** contrôler le formulaire d'invitation à l'écran.
6. **C1 :** publier les créneaux prêts en une fois, avec un compteur et un avis groupé par agent.
7. **C5 :** étapes du tableau de bord qui suivent l'état réel, et un mot par notion.
8. **B1 :** ouvrir la première campagne depuis l'application, avant qu'un deuxième centre démarre.

**Documentation à rectifier :** `docs/RECETTE.md` §5.1 dit de déclencher le rappel « depuis le tableau de bord ou l'écran Campagnes ». Seul le tableau de bord porte « Relancer N agents » ; l'écran Campagnes n'en a pas (capture C-campagnes).

## 9. Vérifications exécutées

| Vérification                                | Résultat                                              |
| ------------------------------------------- | ----------------------------------------------------- |
| Parcours A à E, téléphone et ordinateur     | 5 réussis, 70 captures avec leur texte exact          |
| Cibles tactiles, six écrans sur téléphone   | `parcours/captures/cibles.txt`                        |
| Écrans personnels d'un encadrant            | Accessibles par leur adresse, absents du menu         |
| Constats de la relecture du code repris ici | Revérifiés au fichier et à la ligne, ou vus à l'écran |

**Écarté comme artefact de la pile locale :** une déconnexion de l'agent juste après l'activation.

- **La cause :** l'application est servie sur `127.0.0.1`, mais le serveur se redirige vers `localhost`. Le cookie de session part donc sur `localhost`, et le script revenait sur `127.0.0.1`, où il n'y en a pas. En production, l'adresse ne change pas.
- **La preuve :** sur la même adresse, la session tient (`parcours/deconnexion.spec.ts`).
- **Au démarrage de Docker :** un léger décalage d'horloge a produit une fois « JWT issued at future ». Les horloges se sont réalignées d'elles-mêmes.

**Non vérifié :**

- de vrais utilisateurs (chapitre 7) ;
- de vrais téléphones, et la lecture avec VoiceOver ou TalkBack ;
- l'email d'invitation dans Outlook ;
- l'installation de l'application ;
- le contenu détaillé du guide des gestionnaires, dont seuls les titres ont été relus.
