# Plan de développement — DispoSP

État au 21 septembre 2026. **Les seize premières migrations sont appliquées** sur le projet de développement, les deux du Web Push comprises ; le tableau des migrations du [README](README.md) fait foi. Une dix-septième attend : le verrou de publication issu de la revue du 21 septembre. Le reste tient à la configuration de l’hébergement et à la recette, pas au schéma. Les statuts ci-dessous distinguent les fonctionnalités implémentées des vérifications restant à effectuer sur le site hébergé.

Ce document complète le cahier des charges V1.0 du 17 septembre 2026 et `DECISIONS_FONCTIONNELLES.md`, qui restent la référence fonctionnelle. La configuration et les commandes sont détaillées dans le [README](README.md). Les réserves techniques encore ouvertes — droits de lecture à trancher, écritures composées, découpage de `loadState()` — sont suivies dans [la revue technique](ANALYSE.md).

## 1. Où en est le projet

L’application ne tourne plus que **branchée sur Supabase** : authentification, lecture et écriture selon les droits du compte. Le mode démonstration a été retiré, avec ses données d’exemple et sa sauvegarde dans le navigateur — il n’existe donc plus de déploiement capable d’afficher de fausses données à la place des vraies.

Le parcours agent → validation → affectation → publication → consultation a déjà été consigné comme observé sur le centre de test. L’administration, les notifications, les exports et les disponibilités habituelles sont désormais implémentés. Cette mise à jour documentaire ne constitue pas une nouvelle recette du projet hébergé.

Les redirections d’authentification, la configuration Resend et celle des notifications poussées restent à confirmer sur l’hébergement avant la mise en service.

### Avancement par domaine

| Domaine                     | État                      | Détail                                                                                                                               |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Socle technique             | ✅ implémenté             | Versionnement, formatage, lint, types et intégration continue                                                                        |
| Base de données             | 🟡 une migration à passer | 22 tables, seize migrations appliquées et le verrou de publication à passer, isolation RLS et règles métier                          |
| Authentification            | 🟡 SSO à configurer       | Inscription, confirmation d’adresse, connexion, mot de passe oublié, session et déconnexion ; SSO SAML écrit, fournisseur à déclarer |
| Lecture et écriture         | ✅ implémentées           | Données et commandes métier raccordées à Supabase                                                                                    |
| Administration              | ✅ implémentée            | Fiches agents avec grade et fonction, invitations, équipes, trois rôles et qualifications                                            |
| Besoins et statistiques     | ✅ implémentés            | Besoins du mois en lot ; statistiques par mois, par jour de semaine et par agent                                                     |
| Désistements                | ✅ implémentés            | L’agent signale, l’encadrement tranche ; la réaffectation reste au planning                                                          |
| Disponibilités habituelles  | ✅ implémentées           | Modèle personnel par jour de semaine ; enregistrement et application atomiques                                                       |
| Synthèse et couverture      | ✅ implémentées           | Matrice virtualisée, vue nominative par journée, niveaux de couverture et distinction potentiel/planifié                             |
| Planning et équité          | ✅ implémentés            | Brouillon, publication contrôlée, répartition Jour/Nuit/24 h                                                                         |
| Historique et audit         | ✅ implémentés            | Journal, filtres sujet/auteur/période/recherche et export du journal                                                                 |
| Notifications               | 🟡 recette à compléter    | Centre interne, rappels manuels, emails Resend et notifications poussées implémentés ; clés VAPID et réception à vérifier            |
| Exports                     | ✅ implémentés            | CSV, ICS, Excel, journal d’audit et impression PDF, matrice mensuelle comprise                                                       |
| Application installable     | ✅ implémentée            | Interface adaptée au mobile, manifeste, icônes, installation sur l’écran d’accueil et notifications poussées                         |
| Hébergement et exploitation | 🟡 à confirmer            | Configuration connectée, emails, sauvegardes et recette à plusieurs comptes                                                          |

### Garanties métier

- Jour 8 h–20 h et Nuit 20 h–8 h le lendemain par défaut ; horaires configurables pour les nouvelles campagnes. La nuit est rattachée à sa date de début.
- Une disponibilité 24 h couvre les besoins Jour et Nuit, sans affecter automatiquement l’agent.
- La couverture potentielle repose sur les disponibilités validées ; la couverture planifiée repose sur les affectations du brouillon. Huit agents disponibles ne signifient pas huit agents affectés.
- Modifier une disponibilité invalide la réponse ; une validation explicite reste nécessaire, y compris après application d’un modèle habituel.
- La publication vérifie en base l’effectif, les qualifications et l’éligibilité des agents. Le brouillon reste distinct de la version publiée que consultent les agents.
- Le journal d’audit est alimenté en base et conserve les anciennes et nouvelles valeurs.

### Vérification et portée

La suite couvre les règles métier, les migrations et droits sur PostgreSQL embarqué via PGlite, les exports et des parcours navigateur sur ordinateur et mobile. Un scénario à 300 agents vérifie notamment la virtualisation de la synthèse. Deux tests gardent l’adaptation aux écrans : aucun débordement horizontal à 320 ni 768 px, et aucune commande sous 24 px de côté. Il ne remplace pas une mesure de charge du service hébergé avec plusieurs utilisateurs simultanés.

Les six contrôles de l’intégration continue sont le formatage, le lint, les types, les tests unitaires et de base, la construction et les tests navigateur. Leurs résultats courants font foi. Au 22 septembre 2026 : 209 tests unitaires et de base, dont 114 sur PostgreSQL embarqué — les notifications poussées y ajoutent la liste des services de remise acceptés, le contenu envoyé, l’isolation des abonnements et la file d’envoi — et 22 parcours navigateur passés avec un compte d’essai. **Aucune vérification sur le projet hébergé n’est revendiquée ici** : la réception réelle sur un téléphone relève de la recette.

## 2. Priorités vers une première utilisation

La vérification de ces priorités sur le site public est détaillée pas à pas dans [la recette](RECETTE.md).

| Priorité | Action                                                                | Résultat attendu                                                              |
| -------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1        | Confirmer le mode connecté sur l’hébergement et les URL Supabase Auth | Connexion et confirmation d’adresse depuis l’URL publique                     |
| 2        | Tester l’invitation avec un second compte                             | Compte confirmé, rattaché au bon centre avec le bon rôle                      |
| 3        | Configurer Resend et vérifier la réception                            | Emails d’ouverture, de rappel et de publication reçus avec des liens corrects |
| 4        | Faire une recette métier avec plusieurs agents                        | Modèles habituels, validation, couverture, publication et exports cohérents   |
| 5        | Déployer la version utilisant les écritures atomiques                 | Pas de campagne ni de modèle partiellement enregistré après un échec          |
| 6        | Déclarer les clés VAPID sur l’hébergeur, puis reconstruire            | Un téléphone activé reçoit la notification, application fermée                |
| 6        | Préparer l’exploitation                                               | Sauvegarde restaurable, suivi des erreurs et règles de conservation définis   |

Le développement des lots 3 et 5 a avancé : la priorité porte désormais sur leur recette en mode connecté, les limites identifiées et la mise en service. L’application d’une migration ne prouve pas à elle seule le bon fonctionnement du parcours utilisateur hébergé.

## 3. Le plan complet, lot par lot

### Lot 0 — Socle ✅ implémenté

Versionnement et outillage, authentification, lecture des données, intégration continue et virtualisation de la synthèse. Seize migrations sont appliquées et le verrou de publication reste à passer ; le schéma compte 22 tables.

### Lot 1 — Écriture des données ✅ implémentée, déploiement à confirmer

Les commandes métier passent par l’action serveur `submitCommand`. La charge utile est validée par Zod et l’identité provient de la session ; les refus de la base sont traduits en français sans repli silencieux vers le stockage local.

Sont raccordés : saisie et validation, affectation/retrait, besoins, publication, création/clôture des campagnes, horaires, administration, notifications et disponibilités habituelles. La migration `0003_client_writes.sql` a ouvert les opérations de publication et de paramétrage et complété l’audit.

**Fiabilisation livrée :** `public.create_campaign()` regroupe la campagne, le planning, les créneaux, les participants et leurs notifications dans une transaction, sous les droits de l’appelant. Un échec annule aussi l’audit ; les emails ne partent qu’après réussite. Les tests PostgreSQL couvrent l’échec tardif, les droits entre équipes et centres, les membres inactifs, les longueurs de mois et la clôture en heure de Paris.

**Migration appliquée :** `20260918151529_atomic_campaign_creation.sql`, confirmation du porteur du projet. **À confirmer ensuite :** déploiement de la version de l’application utilisant cette fonction, puis vérification de la création d’une campagne sur le centre de test.

`public.save_availability_template()` et `public.apply_availability_template()` font de même pour la disponibilité habituelle. La première remplace la semaine sous une seule instruction : un refus rend à l’agent la semaine qu’il avait, au lieu de la lui laisser vide, ce que l’effacement suivi d’une réécriture ne garantissait pas. La seconde écrit le mois d’un bloc, calendrier compris, là où le client appliquait un type de disponibilité à la fois et pouvait s’arrêter en chemin. Les déclencheurs gardent leurs règles : fenêtre ouverte, date dans la campagne, invalidation de la réponse.

**Migration appliquée :** `20260918180846_atomic_availability_templates.sql`, confirmation du porteur du projet. **À confirmer ensuite :** déploiement de la version qui appelle ces deux fonctions, puis enregistrement et application d’un modèle sur le centre de test.

### Lot 2 — Agents et administration ✅ implémentés, recette d’invitation restante

- Fiche agent : nom, grade, fonction, matricule, téléphone et statut actif/inactif ; adresse email liée au compte d’authentification. Le grade et la fonction sont deux champs distincts, choisis dans des listes tenues côté interface — la base accepte le texte, de sorte qu’allonger une liste ne demande pas de migration.
- Invitations, modification des fiches, changement d’équipe et de rôle selon les droits, désactivation/réactivation et attribution de qualifications. **L’invitation ne demande plus l’équipe** : l’invité rejoint celle de l’invitant, et sa fiche permet ensuite de le déplacer.
- Création et modification des équipes ; trois rôles pris en compte par l’interface et la base — `AGENT`, `GESTIONNAIRE`, `ADMIN`. `RESPONSABLE` a été retiré : un gestionnaire gère tout son centre, et seul un administrateur change un rôle.
- Historique filtrable par sujet, auteur et recherche libre.

La migration `0004_agent_administration.sql` permet ces opérations. Le premier centre et son administrateur nécessitent toujours les scripts de provisionnement ; les agents suivants passent par une invitation enregistrée dans l’application, puis leur inscription et la confirmation de leur adresse.

**L’envoi de l’invitation est implémenté.** Le gestionnaire envoie, l’agent reçoit un lien d’activation, choisit son mot de passe et rejoint son centre : personne ne choisit ni ne transmet le mot de passe d’un agent. Une invitation en attente se renvoie ou s’annule. Un agent dont le compte existe déjà est rattaché à l’enregistrement même de l’invitation, sans message.

Cela introduit **la première clé secrète du projet**, `SUPABASE_SECRET_KEY` : créer un compte est une opération d’administration que la clé publiable ne peut pas faire. Elle est cantonnée à un module `server-only` et ne sert qu’à l’invitation — voir le README.

**À vérifier :** le parcours complet sur Supabase hébergé, avec les deux gabarits d’e-mail réglés, et le contrôle du rattachement, des droits et de l’audit.

### Lot 3 — Notifications 🟡 implémentées, réception à valider

- Centre de notifications avec état lu/non lu.
- Notifications d’ouverture de campagne, de publication et de rappel aux agents n’ayant pas validé.
- Envoi via Resend après les commandes concernées ; file portée par `notifications`, avec suivi séparé de l’envoi et de la lecture.
- Migrations `0005_notifications.sql` et `0006_email_dispatch.sql` appliquées.

L’envoi nécessite **les trois variables** `RESEND_API_KEY`, `RESEND_FROM` et `APP_URL`. En leur absence, les notifications restent disponibles dans l’application et les emails restent en attente.

**À faire :** vérifier l’expéditeur et la réception réelle des trois types de message, puis définir le suivi des échecs et les reprises. Le rappel est déclenché manuellement. Les envois se font par lots de 50 ; aucune tâche autonome ne traite toute la file ou ne programme les relances. Prévenir les doublons lors d’une reprise après un envoi réussi mais un marquage échoué.

#### Notifications poussées sur le téléphone 🟡 implémentées, migrations et réception à valider

Un email se lit quand on ouvre sa boîte, le centre de messages quand on ouvre l’application. Ni l’un ni l’autre n’atteint l’agent qui n’a rien ouvert — celui-là même que vise une campagne qui s’ouvre ou un planning qui change. La notification poussée arrive sur l’écran verrouillé, application fermée.

- **L’abonnement appartient à l’appareil, pas au compte.** Chaque téléphone s’active séparément, depuis **Mon profil** ou **Notifications**, et un bouton d’essai permet de le vérifier sur-le-champ.
- **La question se pose d’elle-même à la connexion, une seule fois.** Une fenêtre s’ouvre à l’arrivée dans l’espace de travail ; la réponse est gardée sur l’appareil et ne revient pas à la connexion suivante, qu’elle soit oui ou non. Fermer la fenêtre vaut refus, et elle le dit.
- La file des envois vit en base, comme celle des emails : un déclencheur inscrit un envoi par appareil abonné, le serveur réserve un lot de dix par bail de deux minutes, cinq tentatives espacées, abandon au-delà de vingt-quatre heures. Un 404 ou un 410 du service de remise efface l’abonnement.
- **Le message est volontairement pauvre** : la nature de l’événement, rien d’autre. Ni nom, ni motif de désistement, ni date de garde — un écran verrouillé se lit par-dessus l’épaule.
- Aucun rattrapage : activer les notifications ne fait pas remonter les messages écrits avant l’activation.
- Le traitement part après la réponse de chaque commande. `POST /api/push/dispatch`, protégé par `PUSH_DISPATCH_SECRET`, ouvre le même traitement à un planificateur externe ; aucun n’est configuré.
- Migrations `20260921100156_web_push_notifications.sql` et `20260921130000_web_push_abonnement.sql` appliquées.

L’envoi nécessite `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` et `SUPABASE_SECRET_KEY`. En leur absence, l’écran n’offre pas l’activation et les notifications restent dans l’application.

**À faire :** déclarer les quatre variables sur l’hébergeur, reconstruire — la clé publique est figée dans le paquet —, puis vérifier la réception réelle sur Android et sur iPhone. **Sur iPhone, les notifications n’existent que dans l’application installée sur l’écran d’accueil** (iOS 16.4 et au-delà) : ouverte dans Safari, l’application ne peut même pas les proposer.

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

Manifeste, icônes et agent de service : l’application s’ajoute à l’écran d’accueil et s’ouvre en plein écran. L’écran de profil propose l’installation lorsque le navigateur la signale, et donne le chemin iOS, que Safari ne signale jamais. L’agent de service a depuis un second rôle, lui aussi sans cache : recevoir les notifications poussées du lot 3.

**L’agent de service ne met aucune donnée en cache**, et c’est délibéré : un planning ou une disponibilité servis depuis un cache seraient présentés comme à jour sans l’être. Il n’existe que parce qu’un navigateur exige un gestionnaire `fetch` pour proposer l’installation, et il laisse tout passer au réseau. Seule la page `/hors-ligne`, qui ne contient aucune donnée, est conservée.

La consultation hors ligne reste une extension à cadrer. **À confirmer :** installation réelle depuis l’URL publique, sur Android et sur iOS — un manifeste servi en HTTPS est nécessaire, et l’environnement de développement ne le fournit pas. Sur iPhone, cette installation conditionne aussi les notifications poussées.

### Lot 7 — Besoins, statistiques et désistements ✅ implémentés

- **Besoins du mois** : un écran qui pose la règle du mois d’un geste — effectif et minima par qualification, sur tout le mois ou sur certains jours de semaine. Le planning continue de régler une garde à la fois, pour les exceptions ; les deux écrivent la même table.
- **Statistiques** : mois par mois sur l’ensemble des campagnes, par jour de semaine pour repérer les trous réguliers, et par agent. Les taux se calculent sur l’effectif actuel, ce que l’écran affiche en tête : un agent parti ne compte plus dans les mois où il répondait.
- **Désistements** : un agent signale qu’il ne peut plus tenir une garde publiée ; l’encadrement accepte ou refuse. **Accepter ne réaffecte pas** — la base refuse de republier un créneau non couvert, et il n’existe qu’une façon de modifier un planning : l’écran de planning. L’écran des demandes rappelle le remplacement tant qu’il n’est pas fait.

### Hors périmètre V1

**Échanges nommés** entre agents — « je te donne ma garde, tu prends la mienne » —, proposition automatique de planning, règles de repos et intégrations externes. La connexion par compte d’entreprise est écrite mais attend la déclaration d’un fournisseur SAML côté Supabase. Les notifications poussées, d’abord renvoyées à la V2, ont été avancées : elles sont livrées avec le lot 3.

## 4. Couverture du cahier des charges V1

| Exigence (§)                                   | État | Commentaire                                                                                        |
| ---------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| Authentification (§18)                         | ✅   | Email, mot de passe, réinitialisation, inscription et confirmation                                 |
| Rôles et droits (§2)                           | ✅   | Trois rôles en base et dans l’interface                                                            |
| Fiche agent (§3)                               | ✅   | Fiche complète, grade et fonction séparés ; acceptation hébergée à vérifier                        |
| Calendrier cinq états (§4)                     | ✅   | Saisie persistée, validation explicite et invalidation                                             |
| Saisie multiple et règles répétitives (§4)     | ✅   | Périodes et jours de semaine                                                                       |
| Disponibilités habituelles (§4)                | ✅   | Modèles personnels ; enregistrement et application atomiques                                       |
| Campagnes (§5)                                 | ✅   | Création atomique et migration livrées ; déploiement et recette à confirmer                        |
| Tableau de synthèse (§6)                       | ✅   | Colonne figée, tri, filtres, virtualisation                                                        |
| Vue par journée nominative (§6)                | ✅   | Listes nominatives et impression                                                                   |
| Besoins et couverture (§7)                     | ✅   | Effectifs, qualifications, potentiel et planifié distincts                                         |
| Planning et publication (§8)                   | ✅   | Publication vérifiée et version figée en base                                                      |
| Tableau d’équité (§8)                          | ✅   | Ventilation Jour/Nuit/24 h                                                                         |
| Tableau de bord (§9)                           | ✅   | Niveaux déficit/limite/couvert et besoins non définis                                              |
| Notifications (§10)                            | 🟡   | Centre interne, Resend et Web Push implémentés ; migrations et réception à vérifier, rappel manuel |
| Exports (§11)                                  | ✅   | CSV, ICS, Excel et journal ; PDF par impression, matrice comprise                                  |
| Historique et audit (§12)                      | ✅   | Journal, filtres sujet/auteur/période/recherche et export CSV                                      |
| Modèle de données (§14)                        | ✅   | 22 tables ; seize migrations appliquées, une à passer                                              |
| Sécurité et RGPD (§16)                         | 🟡   | Contrôles techniques présents ; dispositions d’exploitation à compléter                            |
| Responsive et installable (§17)                | ✅   | De 320 px au grand écran ; manifeste, icônes, agent et notifications poussées                      |
| Interface à plusieurs centaines d’agents (§21) | 🟡   | Scénario de virtualisation à 300 agents ; charge hébergée à mesurer                                |

## 5. À décider ou confirmer, hors développement

1. **Hébergement.** Mode du site public, domaine, disponibilité attendue et responsabilité d’exploitation.
2. **Emails.** Resend est intégré ; confirmer l’expéditeur, son domaine et les variables serveur, puis contrôler la réception.
3. **Notifications poussées.** Les deux migrations sont passées ; reste à déclarer la paire de clés VAPID et son contact sur l’hébergeur, puis à décider si un planificateur externe appelle `/api/push/dispatch`. Décider aussi ce qu’on dit aux agents : l’activation se fait appareil par appareil, et sur iPhone elle suppose l’application installée sur l’écran d’accueil.
4. **Entrées et sorties.** Qui invite, qui gère les rôles et comment traiter les départs et demandes d’effacement.
5. **Conservation des données.** Information des agents, durée de conservation et procédure d’effacement compatible avec l’historique.
6. **Centre pilote.** Désigner les premiers agents et responsables qui réaliseront la recette.
7. **Migrations suivantes.** Confirmer le mode de suivi des migrations déjà appliquées avant de passer à un déploiement par la CLI Supabase.

## 6. Risques à suivre

| Risque                                              | Portée                                              | Réduction                                                                                        |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Échec pendant la création d’une campagne            | Campagne incomplète                                 | Transaction testée, migration appliquée ; déployer et vérifier le parcours                       |
| Deux responsables publient le même créneau ensemble | Échec brutal sur violation de contrainte            | Verrou de ligne écrit (`20260921140000`), à appliquer                                            |
| Deux responsables modifient le même brouillon       | Conflit de modification, dernier écrivain gagnant   | Vérifier la concurrence et signaler les conflits dans l’interface                                |
| Mode public ou URL Auth mal configurés              | Démonstration affichée ou confirmation inaccessible | Recette depuis l’URL publique avec un second compte                                              |
| Invitation non éprouvée sur le projet hébergé       | Arrivée d’un agent bloquée                          | Vérifier inscription, confirmation, rattachement et droits                                       |
| Emails en attente ou renvoyés                       | Agents non prévenus ou messages en double           | Suivi de la file, reprise et prévention des doublons                                             |
| Clé VAPID régénérée après la mise en service        | Tous les téléphones abonnés deviennent muets        | Garder la paire avec les autres secrets ; en cas de changement, prévenir les agents de réactiver |
| Notifications poussées activées puis oubliées       | Agent qui croit être prévenu et ne l’est plus       | Bouton d’essai sur le profil ; l’email et le centre de messages restent le filet                 |
| Charge et restauration non vérifiées en hébergement | Dégradation ou reprise difficile                    | Essai à plusieurs comptes, mesure de charge et exercice de restauration                          |

## 7. Comment vérifier l’état à tout moment

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Ces six contrôles sont exécutés par l’intégration continue ; leurs résultats sont visibles dans l’onglet Actions du dépôt. Les parcours navigateur qui demandent une session ne s’exécutent qu’avec un projet Supabase joignable, que l’intégration continue n’a pas : elle vérifie le manifeste, l’agent de service et l’adaptation aux écrans.

Les tests de `tests/e2e/connexion.spec.ts` nécessitent un build et un environnement en mode connecté. Ils vérifient les protections et erreurs d’authentification, pas le parcours complet d’un agent invité. Voir le README pour les commandes et prérequis.

## 8. Prochaine action

Les migrations étant toutes appliquées, déployer la version de l’application qui appelle `public.create_campaign()`, les deux fonctions de disponibilité habituelle et les fonctions Web Push, si ce n’est pas déjà fait. Vérifier la création d’une campagne : un planning complet, deux créneaux par date et les seuls membres actifs de l’équipe comme participants.

Effectuer une recette sur l’URL publique avec un administrateur et un second compte agent :

1. Confirmer le mode connecté, les URL Supabase Auth, les trois variables Resend et les trois du Web Push.
2. Enregistrer une invitation, transmettre l’adresse de l’application, créer le compte invité et confirmer son email. Vérifier son centre, son rôle et l’historique.
3. Enregistrer un modèle de disponibilités habituelles, le retrouver après reconnexion, l’appliquer à une campagne ouverte puis valider explicitement. Vérifier qu’une modification invalide la réponse.
4. Comparer couverture potentielle et planifiée, affecter puis publier un créneau, et contrôler ce que voit l’agent.
5. Vérifier les notifications internes et les emails d’ouverture, de rappel et de publication avec des comptes et campagnes adaptés.
6. Activer les notifications poussées depuis un téléphone — installé sur l’écran d’accueil s’il s’agit d’un iPhone —, envoyer l’essai, puis ouvrir une campagne et vérifier que la bulle arrive application fermée.
7. Contrôler les exports CSV, Excel, ICS et l’impression, puis consigner les résultats et les éventuels écarts.
