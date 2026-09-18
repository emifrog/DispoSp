# Plan de développement — DISPO SP

État au 18 septembre 2026. Ce document recense ce qui est fait, ce qui reste, et ce qu'il faut précisément pour qu'un centre puisse utiliser l'application avec de vrais agents.

Il complète le cahier des charges V1.0 du 17 septembre 2026 et `DECISIONS_FONCTIONNELLES.md`, qui restent la référence fonctionnelle.

---

## 1. Où en est le projet

L'application existe en deux modes. Le premier est une **démonstration locale** complète : les dix écrans fonctionnent, les données vivent dans le navigateur, aucun compte n'est nécessaire. Le second est le **mode connecté** : l'utilisateur s'authentifie, les écrans lisent la base de données réelle, et **la saisie s'y enregistre**.

Le parcours complet a été observé sur un centre réel : un agent renseigne son mois, valide sa réponse, un responsable définit les besoins, affecte, publie, et l'agent retrouve sa garde. La coupure principale vers une application utilisable n'est donc plus l'écriture, mais l'administration des comptes et l'absence d'hébergement.

### Avancement par domaine

| Domaine                 | État       | Détail                                                    |
| ----------------------- | ---------- | --------------------------------------------------------- |
| Socle technique         | ✅ terminé | Versionnement, formatage, lint, intégration continue      |
| Base de données         | ✅ terminé | 17 tables déployées, droits et règles vérifiés            |
| Authentification        | ✅ terminé | Connexion, session, déconnexion                           |
| Lecture des données     | ✅ terminé | Les écrans lisent la base                                 |
| Écriture des données    | ✅ terminé | Les huit commandes écrivent en base, sous RLS             |
| Historique et audit     | ✅ terminé | Journal tenu par la base, lisible en français             |
| Administration          | ❌ à faire | Comptes et équipes se gèrent en SQL                       |
| Notifications           | 🟡 partiel | La table existe, aucun email n'est envoyé                 |
| Exports                 | 🟡 partiel | CSV et ICS faits, Excel et PDF absents                    |
| Application installable | ❌ à faire | Le site est adapté au mobile, mais non installable        |
| Hébergement             | ❌ à faire | L'application ne tourne que sur un poste de développement |

### Ce qui est solide

Le socle de données porte les règles métier, et il est plus strict que l'interface. Publier un créneau déclenche une vérification en base de l'effectif, des qualifications et de l'éligibilité de chaque agent ; un agent affecté sans disponibilité validée fait échouer la publication. Le brouillon du responsable et la version publiée sont deux choses distinctes : modifier le brouillon ne change pas ce que les agents voient. Aucune session cliente ne peut écrire une version publiée.

L'invalidation d'une réponse après modification est elle aussi tenue par la base : modifier un jour remet la réponse « à valider » sans que l'interface ait à y penser. Le journal d'audit est écrit par des déclencheurs, jamais par le navigateur : aucune session ne peut forger ni omettre une ligne.

Ces garanties tiennent même si l'interface se trompe, ce qui est le bon endroit pour les placer.

### Mesure de la qualité

|                                     | Valeur                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| Tests automatisés                   | 53 unitaires, 16 de bout en bout                                     |
| Vérifications à chaque modification | 6, exécutées automatiquement                                         |
| Tenue en charge mesurée             | 300 agents : ~25 lignes affichées au lieu de 300, 13 ms par commande |

---

## 2. Le chemin critique vers une première utilisation

Tout n'est pas également urgent. Voici ce qui **empêche réellement** un centre de se servir de l'application, par ordre de dépendance.

| #     | Verrou                                  | Pourquoi c'est bloquant                                   | Lot       |
| ----- | --------------------------------------- | --------------------------------------------------------- | --------- |
| ~~1~~ | ~~Les saisies ne s'enregistrent pas~~   | Levé le 18 septembre 2026                                 | ~~Lot 1~~ |
| 2     | Aucun écran pour créer un agent         | Chaque arrivée demande une manipulation en base           | Lot 2     |
| 3     | Pas de grade ni de matricule            | Le cahier des charges les exige, les écrans les affichent | Lot 2     |
| 4     | Personne n'est prévenu d'une campagne   | Sans email, le taux de réponse s'effondre                 | Lot 3     |
| 5     | L'application n'est hébergée nulle part | Elle n'est accessible depuis aucun téléphone              | Lot 4     |

**Les lots 2 à 4 constituent le minimum utilisable restant.** Tout le reste — exports Excel et PDF, installation sur l'écran d'accueil, quatre rôles distincts — améliore l'usage sans le conditionner.

Le verrou le plus proche est désormais le **deuxième agent** : tant qu'un centre ne peut pas créer de comptes depuis l'application, l'usage réel reste à une personne.

---

## 3. Le plan complet, lot par lot

Les tailles sont indicatives : **S** = quelques heures, **M** = une à deux journées, **L** = plusieurs journées.

### Lot 0 — Socle ✅ terminé

Versionnement et outillage, base de données complète et déployée, authentification, lecture des données, intégration continue, virtualisation de la synthèse.

### Lot 1 — Écriture des données ✅ terminé

Les huit commandes du domaine passent par une action serveur unique, `submitCommand`, dont la charge utile est parsée par Zod et l'identité lue dans le cookie de session.

| Commande                   | Effet                                                        | Vérifiée en base     |
| -------------------------- | ------------------------------------------------------------ | -------------------- |
| Saisir une disponibilité   | Écrit la journée ; la base invalide la réponse à la campagne | ✅                   |
| Valider sa réponse         | La base contrôle que le mois est complet                     | ✅                   |
| Affecter, retirer un agent | Modifie le brouillon du planning                             | ✅                   |
| Publier un créneau         | Passe par `public.publish_shift()`                           | ✅                   |
| Définir les besoins        | Effectif et qualifications d'une garde                       | ✅                   |
| Verrouiller une campagne   | Ferme la saisie                                              | ✅                   |
| Modifier les horaires      | Applique aux campagnes suivantes                             | ✅                   |
| Créer une campagne         | Avec son planning, ses créneaux et ses participants          | écrite, non vérifiée |

Comprend aussi : traduction en français des refus de la base, rechargement des écrans après écriture, et le journal d'audit tenu par des déclencheurs avec ancienne et nouvelle valeur.

Une migration `0003_client_writes.sql` a été nécessaire : la publication n'était joignable depuis aucune session cliente, les horaires du centre n'étaient écrivables par personne, et le journal d'audit n'avait aucun rédacteur.

Deux réserves. La création d'une campagne écrit en quatre requêtes sans transaction : un échec laisserait une campagne incomplète. Et elle n'a pas été essayée sur le centre de test, puisqu'aucune session cliente ne peut supprimer une campagne.

### Lot 2 — Agents et administration ❌ à faire · taille **M**

- Migration ajoutant grade, matricule et téléphone à la fiche agent, exigés au §3 du cahier des charges et absents aujourd'hui.
- Écrans d'administration : créer un agent, le rattacher à une équipe, lui donner des qualifications, le désactiver. Le catalogue de qualifications est écrivable depuis `0003`, mais sans écran : il se remplit au fil des besoins définis.
- Filtrer l'écran Historique. Le journal est désormais tenu ligne à ligne ; une saisie rapide d'un mois par un agent produit trente et une entrées, et l'écran affiche les deux cents dernières sans distinction.
- Invitation d'un nouvel agent par email, en remplacement du script SQL.
- Les quatre rôles du cahier des charges dans l'interface — agent, chef, gestionnaire, administrateur — là où deux sont distingués aujourd'hui.

### Lot 3 — Notifications ❌ à faire · taille **M**

- Envoi des emails à l'ouverture d'une campagne, en rappel avant clôture, et à la publication d'un planning.
- Centre de notifications dans l'application ; la table existe déjà et se remplit à la publication.
- Choix d'un service d'envoi et configuration du domaine expéditeur.

### Lot 4 — Mise en service ❌ à faire · taille **S**

- Hébergement de l'application et nom de domaine.
- Vérification du plan Supabase : un projet gratuit se met en veille après inactivité, ce qui est incompatible avec un usage réel.
- Mentions légales, information des agents, durée de conservation des données.
- Sauvegardes et procédure de restauration vérifiée.

### Lot 5 — Exports et confort ❌ à faire · taille **M**

- Exports Excel et PDF du planning et de la synthèse.
- Historique consultable par entité, par auteur et par période — les lignes et leurs deux valeurs sont déjà affichées, sans filtre.
- Vue par journée avec listes nominatives, heatmap à trois niveaux, tableau d'équité ventilé Jour et Nuit.
- Disponibilités habituelles réutilisables d'une campagne à l'autre.

### Lot 6 — Application installable ❌ à faire · taille **S**

Installation sur l'écran d'accueil du téléphone, fonctionnement hors ligne en consultation, notifications poussées.

### Hors périmètre V1

Échanges de garde entre agents, proposition automatique de planning, règles de repos, connexion par compte d'entreprise, intégrations externes.

---

## 4. Couverture du cahier des charges V1

| Exigence (§)                                   | État | Commentaire                                             |
| ---------------------------------------------- | ---- | ------------------------------------------------------- |
| Authentification (§18)                         | ✅   | Email et mot de passe                                   |
| Rôles et droits (§2)                           | 🟡   | Quatre rôles en base, deux dans l'interface             |
| Fiche agent (§3)                               | 🟡   | Grade, matricule et téléphone manquants                 |
| Calendrier cinq états (§4)                     | ✅   | Saisie enregistrée en base                              |
| Saisie multiple et règles répétitives (§4)     | ✅   | Période, jours de semaine                               |
| Disponibilités habituelles (§4)                | ❌   | Lot 5                                                   |
| Campagnes (§5)                                 | ✅   | Création, verrouillage et horaires raccordés            |
| Tableau de synthèse (§6)                       | ✅   | Colonne figée, tri, filtres, virtualisé                 |
| Vue par journée nominative (§6)                | ❌   | Totaux présents, listes absentes                        |
| Besoins et couverture (§7)                     | ✅   | Saisis et contrôlés en base                             |
| Planning et publication (§8)                   | ✅   | Publication vérifiée et figée en base                   |
| Tableau d'équité (§8)                          | 🟡   | Total par agent, sans ventilation Jour/Nuit             |
| Tableau de bord (§9)                           | 🟡   | Complet, sauf heatmap à trois niveaux                   |
| Notifications (§10)                            | 🟡   | Table prête, envoi absent                               |
| Exports (§11)                                  | 🟡   | CSV et ICS faits ; Excel et PDF absents                 |
| Historique et audit (§12)                      | ✅   | Écrit par la base, exposé en français ; sans filtre     |
| Modèle de données (§14)                        | ✅   | 17 tables déployées, trois migrations                   |
| Sécurité et RGPD (§16)                         | 🟡   | Technique en place ; mentions et conservation à traiter |
| Responsive et installable (§17)                | 🟡   | Adapté au mobile, non installable                       |
| Interface à plusieurs centaines d'agents (§21) | ✅   | Mesuré à 300 agents                                     |

---

## 5. À décider, hors développement

Ces points ne relèvent pas du code, et conditionnent la mise en service.

1. **Plan Supabase.** Un projet gratuit se met en veille après inactivité. À trancher avant que des agents en dépendent.
2. **Hébergement.** Où l'application tourne, sous quel nom de domaine, qui en a la charge.
3. **Service d'envoi d'emails.** Nécessaire au lot 3, avec un domaine expéditeur vérifié.
4. **Création des comptes.** Qui crée les agents, et selon quelle procédure d'entrée et de sortie.
5. **RGPD.** Information des agents, base légale, durée de conservation, procédure d'effacement. Une suppression de compte est aujourd'hui bloquée par les contraintes de la base — c'est volontaire, mais il faut décider de la marche à suivre.
6. **Périmètre de la première mise en service.** Un centre pilote, ou tous d'emblée.

---

## 6. Risques

| Risque                                            | Portée                     | Réduction                                                                           |
| ------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Une création de campagne échoue à mi-chemin       | Campagne incomplète        | Quatre requêtes sans transaction ; à déplacer derrière une fonction de base         |
| Deux responsables modifient le même planning      | Perte de modification      | La révision existe en base ; reste à traiter le conflit dans l'interface            |
| Aucun agent réel n'a encore utilisé l'application | Fonctionnalités inadaptées | Le parcours complet tient sur un compte ; le faire essayer par deux ou trois agents |
| Le reste du cahier des charges s'accumule         | Périmètre qui s'étire      | Les lots 5 et 6 sont reportables sans empêcher l'usage                              |
| Un projet Supabase en veille                      | Indisponibilité            | Point 1 de la section précédente                                                    |

---

## 7. Comment vérifier l'état à tout moment

```sh
pnpm format:check   # mise en forme
pnpm lint           # qualité
pnpm typecheck      # types
pnpm test           # 53 tests unitaires et de base de données
pnpm build          # construction
pnpm test:e2e       # 16 tests de bout en bout
```

Ces six vérifications s'exécutent automatiquement à chaque modification envoyée sur le dépôt. Leur résultat est visible dans l'onglet Actions de GitHub.

---

## 8. Prochaine action

Créer un deuxième agent, et lui faire renseigner un mois.

Tout ce que l'application sait faire a été observé sur **un seul compte**, qui était à la fois l'agent et le responsable. Les écrans qui comptent — synthèse, couverture, équité — ne disent rien d'utile à un contre un. C'est aussi le premier geste du lot 2, et le seul qui permette de savoir si la saisie tient devant quelqu'un qui n'a pas écrit l'application.

D'ici là, la création d'un compte passe encore par le tableau de bord Supabase et un rattachement en SQL.
