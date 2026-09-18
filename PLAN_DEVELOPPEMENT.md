# Plan de développement — DISPO SP

État au 18 septembre 2026. Les neuf migrations (`0001` à `0007`, puis la création atomique des campagnes et les écritures atomiques de la disponibilité habituelle) sont appliquées sur le projet de développement. Les statuts ci-dessous distinguent les fonctionnalités implémentées des vérifications restant à effectuer sur le site hébergé.

Ce document complète le cahier des charges V1.0 du 17 septembre 2026 et `DECISIONS_FONCTIONNELLES.md`, qui restent la référence fonctionnelle. La configuration et les commandes sont détaillées dans le [README](README.md).

## 1. Où en est le projet

L’application fonctionne en **démonstration locale** ou en **mode connecté** : authentification, lecture et écriture des données Supabase selon les droits du compte. La présence des coordonnées Supabase ne suffit pas à activer ce second mode : `NEXT_PUBLIC_DISPOSP_MODE=connected` est également nécessaire lors de la construction.

Le parcours agent → validation → affectation → publication → consultation a déjà été consigné comme observé sur le centre de test. L’administration, les notifications, les exports et les disponibilités habituelles sont désormais implémentés. Cette mise à jour documentaire ne constitue pas une nouvelle recette du projet hébergé.

Le dernier état documenté du déploiement Vercel était une démonstration. Son mode actuel, les redirections d’authentification et la configuration Resend restent à confirmer avant la mise en service.

### Avancement par domaine

| Domaine                     | État                     | Détail                                                                                                   |
| --------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Socle technique             | ✅ implémenté            | Versionnement, formatage, lint, types et intégration continue                                            |
| Base de données             | ✅ migrations appliquées | 19 tables, huit migrations appliquées, isolation RLS et règles métier                                    |
| Authentification            | ✅ implémentée           | Inscription, confirmation d’adresse, connexion, session et déconnexion                                   |
| Lecture et écriture         | ✅ implémentées          | Données et commandes métier raccordées à Supabase                                                        |
| Administration              | ✅ implémentée           | Fiches agents, invitations, équipes, quatre rôles et qualifications                                      |
| Disponibilités habituelles  | ✅ implémentées          | Modèle personnel par jour de semaine ; enregistrement et application atomiques                           |
| Synthèse et couverture      | ✅ implémentées          | Matrice virtualisée, vue nominative par journée, niveaux de couverture et distinction potentiel/planifié |
| Planning et équité          | ✅ implémentés           | Brouillon, publication contrôlée, répartition Jour/Nuit/24 h                                             |
| Historique et audit         | ✅ implémentés           | Journal, filtres sujet/auteur/période/recherche et export du journal                                     |
| Notifications               | 🟡 recette à compléter   | Centre interne, lecture, rappels manuels et envoi Resend implémentés ; réception à vérifier              |
| Exports                     | ✅ implémentés           | CSV, ICS, Excel, journal d’audit et impression PDF, matrice mensuelle comprise                           |
| Application installable     | ✅ implémentée           | Interface adaptée au mobile, manifeste, icônes et installation sur l’écran d’accueil                     |
| Hébergement et exploitation | 🟡 à confirmer           | Configuration connectée, emails, sauvegardes et recette à plusieurs comptes                              |

### Garanties métier

- Jour 8 h–20 h et Nuit 20 h–8 h le lendemain par défaut ; horaires configurables pour les nouvelles campagnes. La nuit est rattachée à sa date de début.
- Une disponibilité 24 h couvre les besoins Jour et Nuit, sans affecter automatiquement l’agent.
- La couverture potentielle repose sur les disponibilités validées ; la couverture planifiée repose sur les affectations du brouillon. Huit agents disponibles ne signifient pas huit agents affectés.
- Modifier une disponibilité invalide la réponse ; une validation explicite reste nécessaire, y compris après application d’un modèle habituel.
- La publication vérifie en base l’effectif, les qualifications et l’éligibilité des agents. Le brouillon reste distinct de la version publiée que consultent les agents.
- Le journal d’audit est alimenté en base et conserve les anciennes et nouvelles valeurs.

### Vérification et portée

La suite couvre les règles métier, les migrations et droits sur PostgreSQL embarqué via PGlite, les exports et des parcours navigateur sur ordinateur et mobile. Un scénario à 300 agents vérifie notamment la virtualisation de la synthèse. Il ne remplace pas une mesure de charge du service hébergé avec plusieurs utilisateurs simultanés.

Les six contrôles de l’intégration continue sont le formatage, le lint, les types, les tests unitaires et de base, la construction et les tests navigateur. Leurs résultats courants font foi ; aucun nouveau résultat de test applicatif n’est revendiqué par cette mise à jour documentaire.

## 2. Priorités vers une première utilisation

| Priorité | Action                                                                | Résultat attendu                                                              |
| -------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1        | Confirmer le mode connecté sur l’hébergement et les URL Supabase Auth | Connexion et confirmation d’adresse depuis l’URL publique                     |
| 2        | Tester l’invitation avec un second compte                             | Compte confirmé, rattaché au bon centre avec le bon rôle                      |
| 3        | Configurer Resend et vérifier la réception                            | Emails d’ouverture, de rappel et de publication reçus avec des liens corrects |
| 4        | Faire une recette métier avec plusieurs agents                        | Modèles habituels, validation, couverture, publication et exports cohérents   |
| 5        | Déployer la version utilisant les écritures atomiques                 | Pas de campagne ni de modèle partiellement enregistré après un échec          |
| 6        | Préparer l’exploitation                                               | Sauvegarde restaurable, suivi des erreurs et règles de conservation définis   |

Le développement des lots 3 et 5 a avancé : la priorité porte désormais sur leur recette en mode connecté, les limites identifiées et la mise en service. L’application d’une migration ne prouve pas à elle seule le bon fonctionnement du parcours utilisateur hébergé.

## 3. Le plan complet, lot par lot

### Lot 0 — Socle ✅ implémenté

Versionnement et outillage, authentification, lecture des données, intégration continue et virtualisation de la synthèse. Les migrations `0001_foundation.sql` à `0007_availability_templates.sql`, puis `20260918151529_atomic_campaign_creation.sql`, sont appliquées ; le schéma compte 19 tables.

### Lot 1 — Écriture des données ✅ implémentée, déploiement à confirmer

Les commandes métier passent par l’action serveur `submitCommand`. La charge utile est validée par Zod et l’identité provient de la session ; les refus de la base sont traduits en français sans repli silencieux vers le stockage local.

Sont raccordés : saisie et validation, affectation/retrait, besoins, publication, création/clôture des campagnes, horaires, administration, notifications et disponibilités habituelles. La migration `0003_client_writes.sql` a ouvert les opérations de publication et de paramétrage et complété l’audit.

**Fiabilisation livrée :** `public.create_campaign()` regroupe la campagne, le planning, les créneaux, les participants et leurs notifications dans une transaction, sous les droits de l’appelant. Un échec annule aussi l’audit ; les emails ne partent qu’après réussite. Les tests PostgreSQL couvrent l’échec tardif, les droits entre équipes et centres, les membres inactifs, les longueurs de mois et la clôture en heure de Paris.

**Migration appliquée :** `20260918151529_atomic_campaign_creation.sql`, confirmation du porteur du projet. **À confirmer ensuite :** déploiement de la version de l’application utilisant cette fonction, puis vérification de la création d’une campagne sur le centre de test.

`public.save_availability_template()` et `public.apply_availability_template()` font de même pour la disponibilité habituelle. La première remplace la semaine sous une seule instruction : un refus rend à l’agent la semaine qu’il avait, au lieu de la lui laisser vide, ce que l’effacement suivi d’une réécriture ne garantissait pas. La seconde écrit le mois d’un bloc, calendrier compris, là où le client appliquait un type de disponibilité à la fois et pouvait s’arrêter en chemin. Les déclencheurs gardent leurs règles : fenêtre ouverte, date dans la campagne, invalidation de la réponse.

**Migration appliquée :** `20260918180846_atomic_availability_templates.sql`, confirmation du porteur du projet. **À confirmer ensuite :** déploiement de la version qui appelle ces deux fonctions, puis enregistrement et application d’un modèle sur le centre de test.

### Lot 2 — Agents et administration ✅ implémentés, recette d’invitation restante

- Fiche agent : nom, grade, matricule, téléphone et statut actif/inactif ; adresse email liée au compte d’authentification.
- Invitations, modification des fiches, changement d’équipe et de rôle selon les droits, désactivation/réactivation et attribution de qualifications.
- Création et modification des équipes ; quatre rôles pris en compte par l’interface et la base.
- Historique filtrable par sujet, auteur et recherche libre.

La migration `0004_agent_administration.sql` permet ces opérations. Le premier centre et son administrateur nécessitent toujours les scripts de provisionnement ; les agents suivants passent par une invitation enregistrée dans l’application, puis leur inscription et la confirmation de leur adresse.

**À vérifier :** accepter une invitation avec un second compte sur Supabase hébergé et contrôler le rattachement, les droits et l’audit. **L’envoi automatique de l’invitation n’est pas implémenté** : l’administrateur transmet l’adresse de l’application. Les emails métier du lot 3 ne remplacent pas cette étape.

### Lot 3 — Notifications 🟡 implémentées, réception à valider

- Centre de notifications avec état lu/non lu.
- Notifications d’ouverture de campagne, de publication et de rappel aux agents n’ayant pas validé.
- Envoi via Resend après les commandes concernées ; file portée par `notifications`, avec suivi séparé de l’envoi et de la lecture.
- Migrations `0005_notifications.sql` et `0006_email_dispatch.sql` appliquées.

L’envoi nécessite **les trois variables** `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL`. En leur absence, les notifications restent disponibles dans l’application et les emails restent en attente.

**À faire :** vérifier l’expéditeur et la réception réelle des trois types de message, puis définir le suivi des échecs et les reprises. Le rappel est déclenché manuellement. Les envois se font par lots de 50 ; aucune tâche autonome ne traite toute la file ou ne programme les relances. Prévenir les doublons lors d’une reprise après un envoi réussi mais un marquage échoué.

### Lot 4 — Mise en service 🟡 configuration et recette à confirmer

- Vérifier les trois variables du mode connecté sur l’hébergeur, puis reconstruire/redéployer après toute modification des variables publiques.
- Déclarer l’adresse publique dans Supabase Auth et dans `APP_URL` ; confirmer le nom de domaine retenu.
- Vérifier que la configuration d’hébergement et de base répond au besoin de disponibilité du centre.
- Définir l’information des agents, la durée de conservation et la procédure d’effacement.
- Préparer les sauvegardes et vérifier la restauration.

### Lot 5 — Exports et confort 🟡 implémentés avec compléments restants

**Livré :**

- CSV de la synthèse filtrée et ICS des gardes personnelles publiées, avec fuseau Europe/Paris.
- Classeur Excel côté serveur en mode connecté : disponibilités, synthèse, couverture, affectations, qualifications et statistiques. Il porte sur la campagne accessible au compte, sans reprendre les filtres locaux de la synthèse.
- Impression de la matrice mensuelle, de la vue par journée et du planning personnel, permettant un enregistrement PDF. La virtualisation est suspendue le temps de l’impression, en paysage et avec l’en-tête répété à chaque page.
- Historique filtrable par sujet, auteur, période et recherche, et exportable en CSV. L’écran signale lorsqu’une période demandée précède les deux cents actions chargées.
- Vue quotidienne avec listes nominatives ; indicateurs déficit/limite/couvert et état distinct lorsque les besoins ne sont pas définis.
- Équité ventilée Jour, Nuit et 24 h ; une garde 24 h représente deux créneaux dans le total.
- Disponibilités habituelles personnelles par jour de semaine, enregistrées en base et applicables au calendrier. **Migrations `0007_availability_templates.sql` et `20260918180846_atomic_availability_templates.sql` appliquées, confirmation du porteur du projet.** L’application d’un modèle ne vaut ni validation ni affectation.

**Reste à faire :**

- Recette en mode connecté des exports et des modèles habituels : isolation entre agents, persistance, application et invalidation de la réponse.

### Lot 6 — Application installable ✅ implémentée

Manifeste, icônes et agent de service : l’application s’ajoute à l’écran d’accueil et s’ouvre en plein écran. L’écran de profil propose l’installation lorsque le navigateur la signale, et donne le chemin iOS, que Safari ne signale jamais.

**L’agent de service ne met aucune donnée en cache**, et c’est délibéré : un planning ou une disponibilité servis depuis un cache seraient présentés comme à jour sans l’être. Il n’existe que parce qu’un navigateur exige un gestionnaire `fetch` pour proposer l’installation, et il laisse tout passer au réseau. Seule la page `/hors-ligne`, qui ne contient aucune donnée, est conservée.

La consultation hors ligne reste une extension à cadrer ; les notifications poussées relèvent de la V2. **À confirmer :** installation réelle depuis l’URL publique, sur Android et sur iOS — un manifeste servi en HTTPS est nécessaire, et l’environnement de développement ne le fournit pas.

### Hors périmètre V1

Notifications poussées, échanges de garde entre agents, proposition automatique de planning, règles de repos, connexion par compte d’entreprise et intégrations externes.

## 4. Couverture du cahier des charges V1

| Exigence (§)                                   | État | Commentaire                                                                 |
| ---------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| Authentification (§18)                         | ✅   | Email, mot de passe, inscription et confirmation                            |
| Rôles et droits (§2)                           | ✅   | Quatre rôles en base et dans l’interface                                    |
| Fiche agent (§3)                               | ✅   | Fiche complète et invitation ; acceptation hébergée à vérifier              |
| Calendrier cinq états (§4)                     | ✅   | Saisie persistée, validation explicite et invalidation                      |
| Saisie multiple et règles répétitives (§4)     | ✅   | Périodes et jours de semaine                                                |
| Disponibilités habituelles (§4)                | ✅   | Modèles personnels ; enregistrement et application atomiques                |
| Campagnes (§5)                                 | ✅   | Création atomique et migration livrées ; déploiement et recette à confirmer |
| Tableau de synthèse (§6)                       | ✅   | Colonne figée, tri, filtres, virtualisation                                 |
| Vue par journée nominative (§6)                | ✅   | Listes nominatives et impression                                            |
| Besoins et couverture (§7)                     | ✅   | Effectifs, qualifications, potentiel et planifié distincts                  |
| Planning et publication (§8)                   | ✅   | Publication vérifiée et version figée en base                               |
| Tableau d’équité (§8)                          | ✅   | Ventilation Jour/Nuit/24 h                                                  |
| Tableau de bord (§9)                           | ✅   | Niveaux déficit/limite/couvert et besoins non définis                       |
| Notifications (§10)                            | 🟡   | Centre interne et Resend implémentés ; réception à vérifier, rappel manuel  |
| Exports (§11)                                  | ✅   | CSV, ICS, Excel et journal ; PDF par impression, matrice comprise           |
| Historique et audit (§12)                      | ✅   | Journal, filtres sujet/auteur/période/recherche et export CSV               |
| Modèle de données (§14)                        | ✅   | 19 tables, huit migrations appliquées                                       |
| Sécurité et RGPD (§16)                         | 🟡   | Contrôles techniques présents ; dispositions d’exploitation à compléter     |
| Responsive et installable (§17)                | ✅   | Adapté au mobile, manifeste, icônes et agent de service                     |
| Interface à plusieurs centaines d’agents (§21) | 🟡   | Scénario de virtualisation à 300 agents ; charge hébergée à mesurer         |

## 5. À décider ou confirmer, hors développement

1. **Hébergement.** Mode du site public, domaine, disponibilité attendue et responsabilité d’exploitation.
2. **Emails.** Resend est intégré ; confirmer l’expéditeur, son domaine et les variables serveur, puis contrôler la réception.
3. **Entrées et sorties.** Qui invite, qui gère les rôles et comment traiter les départs et demandes d’effacement.
4. **Conservation des données.** Information des agents, durée de conservation et procédure d’effacement compatible avec l’historique.
5. **Centre pilote.** Désigner les premiers agents et responsables qui réaliseront la recette.
6. **Migrations suivantes.** Confirmer le mode de suivi des migrations déjà appliquées avant de passer à un déploiement par la CLI Supabase.

## 6. Risques à suivre

| Risque                                              | Portée                                              | Réduction                                                                  |
| --------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Échec pendant la création d’une campagne            | Campagne incomplète                                 | Transaction testée, migration appliquée ; déployer et vérifier le parcours |
| Deux responsables modifient le même planning        | Conflit de modification                             | Vérifier la concurrence et signaler les conflits dans l’interface          |
| Mode public ou URL Auth mal configurés              | Démonstration affichée ou confirmation inaccessible | Recette depuis l’URL publique avec un second compte                        |
| Invitation non éprouvée sur le projet hébergé       | Arrivée d’un agent bloquée                          | Vérifier inscription, confirmation, rattachement et droits                 |
| Emails en attente ou renvoyés                       | Agents non prévenus ou messages en double           | Suivi de la file, reprise et prévention des doublons                       |
| Charge et restauration non vérifiées en hébergement | Dégradation ou reprise difficile                    | Essai à plusieurs comptes, mesure de charge et exercice de restauration    |

## 7. Comment vérifier l’état à tout moment

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Ces six contrôles sont exécutés par l’intégration continue ; leurs résultats sont visibles dans l’onglet Actions du dépôt. La suite navigateur habituelle utilise un build en mode démonstration.

Les tests de `tests/e2e/connexion.spec.ts` nécessitent un build et un environnement en mode connecté. Ils vérifient les protections et erreurs d’authentification, pas le parcours complet d’un agent invité. Voir le README pour les commandes et prérequis.

## 8. Prochaine action

Les migrations étant appliquées, déployer la version de l’application qui appelle `public.create_campaign()` et les deux fonctions de disponibilité habituelle, si ce n’est pas déjà fait. Vérifier la création d’une campagne : un planning complet, deux créneaux par date et les seuls membres actifs de l’équipe comme participants.

Effectuer une recette sur l’URL publique avec un administrateur et un second compte agent :

1. Confirmer le mode connecté, les URL Supabase Auth et les trois variables Resend.
2. Enregistrer une invitation, transmettre l’adresse de l’application, créer le compte invité et confirmer son email. Vérifier son centre, son rôle et l’historique.
3. Enregistrer un modèle de disponibilités habituelles, le retrouver après reconnexion, l’appliquer à une campagne ouverte puis valider explicitement. Vérifier qu’une modification invalide la réponse.
4. Comparer couverture potentielle et planifiée, affecter puis publier un créneau, et contrôler ce que voit l’agent.
5. Vérifier les notifications internes et les emails d’ouverture, de rappel et de publication avec des comptes et campagnes adaptés.
6. Contrôler les exports CSV, Excel, ICS et l’impression, puis consigner les résultats et les éventuels écarts.
