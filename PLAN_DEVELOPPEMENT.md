# Plan de développement — DISPO SP

État au 18 septembre 2026. Ce document recense ce qui est fait, ce qui reste, et ce qu'il faut précisément pour qu'un centre puisse utiliser l'application avec de vrais agents.

Il complète le cahier des charges V1.0 du 17 septembre 2026 et `DECISIONS_FONCTIONNELLES.md`, qui restent la référence fonctionnelle.

---

## 1. Où en est le projet

L'application existe en deux modes. Le premier est une **démonstration locale** complète : les dix écrans fonctionnent, les données vivent dans le navigateur, aucun compte n'est nécessaire. Le second est le **mode connecté** : l'utilisateur s'authentifie et les écrans lisent la base de données réelle.

Le mode connecté est aujourd'hui en **lecture seule**. C'est la coupure principale entre l'état actuel et une application utilisable.

### Avancement par domaine

| Domaine                  | État           | Détail                                                    |
| ------------------------ | -------------- | --------------------------------------------------------- |
| Socle technique          | ✅ terminé     | Versionnement, formatage, lint, intégration continue      |
| Base de données          | ✅ terminé     | 17 tables déployées, droits et règles vérifiés            |
| Authentification         | ✅ terminé     | Connexion, session, déconnexion                           |
| Lecture des données      | ✅ terminé     | Les écrans lisent la base                                 |
| **Écriture des données** | ❌ **à faire** | **Aucune saisie n'est enregistrée en base**               |
| Administration           | ❌ à faire     | Comptes, équipes et qualifications se gèrent en SQL       |
| Notifications            | 🟡 partiel     | La table existe, aucun email n'est envoyé                 |
| Exports                  | 🟡 partiel     | CSV et ICS faits, Excel et PDF absents                    |
| Application installable  | ❌ à faire     | Le site est adapté au mobile, mais non installable        |
| Hébergement              | ❌ à faire     | L'application ne tourne que sur un poste de développement |

### Ce qui est solide

Le socle de données porte les règles métier, et il est plus strict que l'interface. Publier un créneau déclenche une vérification en base de l'effectif, des qualifications et de l'éligibilité de chaque agent ; un agent affecté sans disponibilité validée fait échouer la publication. Le brouillon du responsable et la version publiée sont deux choses distinctes : modifier le brouillon ne change pas ce que les agents voient. Aucune session cliente ne peut écrire une version publiée.

Ces garanties tiennent même si l'interface se trompe, ce qui est le bon endroit pour les placer.

### Mesure de la qualité

|                                     | Valeur                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| Tests automatisés                   | 41 unitaires, 16 de bout en bout                                     |
| Vérifications à chaque modification | 6, exécutées automatiquement                                         |
| Tenue en charge mesurée             | 300 agents : ~25 lignes affichées au lieu de 300, 13 ms par commande |

---

## 2. Le chemin critique vers une première utilisation

Tout n'est pas également urgent. Voici ce qui **empêche réellement** un centre de se servir de l'application, par ordre de dépendance.

| #   | Verrou                                  | Pourquoi c'est bloquant                                   | Lot   |
| --- | --------------------------------------- | --------------------------------------------------------- | ----- |
| 1   | Les saisies ne s'enregistrent pas       | Un agent qui déclare ses disponibilités les perd          | Lot 1 |
| 2   | Aucun écran pour créer un agent         | Chaque arrivée demande une manipulation en base           | Lot 2 |
| 3   | Pas de grade ni de matricule            | Le cahier des charges les exige, les écrans les affichent | Lot 2 |
| 4   | Personne n'est prévenu d'une campagne   | Sans email, le taux de réponse s'effondre                 | Lot 3 |
| 5   | L'application n'est hébergée nulle part | Elle n'est accessible depuis aucun téléphone              | Lot 4 |

**Les lots 1 à 4 constituent le minimum utilisable.** Tout le reste — exports Excel et PDF, installation sur l'écran d'accueil, quatre rôles distincts — améliore l'usage sans le conditionner.

---

## 3. Le plan complet, lot par lot

Les tailles sont indicatives : **S** = quelques heures, **M** = une à deux journées, **L** = plusieurs journées.

### Lot 0 — Socle ✅ terminé

Versionnement et outillage, base de données complète et déployée, authentification, lecture des données, intégration continue, virtualisation de la synthèse.

### Lot 1 — Écriture des données ❌ à faire · taille **L**

Le cœur du travail restant. Les huit commandes du domaine deviennent des actions serveur.

| Commande                   | Effet                                               |
| -------------------------- | --------------------------------------------------- |
| Saisir une disponibilité   | Écrit la journée, invalide la réponse à la campagne |
| Valider sa réponse         | Contrôle que le mois est complet                    |
| Affecter, retirer un agent | Modifie le brouillon du planning                    |
| Publier un créneau         | Passe par la fonction serveur existante             |
| Définir les besoins        | Effectif et qualifications d'une garde              |
| Créer une campagne         | Avec ses participants et ses créneaux               |
| Verrouiller une campagne   | Ferme la saisie                                     |
| Modifier les horaires      | Applique aux campagnes suivantes                    |

Comprend aussi : messages d'erreur en français à partir des refus de la base, rechargement des écrans après écriture, et un chemin de retour quand deux personnes modifient la même chose.

La logique métier existe déjà et est testée ; il s'agit de la faire écrire en base plutôt que dans le navigateur.

### Lot 2 — Agents et administration ❌ à faire · taille **M**

- Migration ajoutant grade, matricule et téléphone à la fiche agent, exigés au §3 du cahier des charges et absents aujourd'hui.
- Écrans d'administration : créer un agent, le rattacher à une équipe, lui donner des qualifications, le désactiver.
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
- Historique consultable dans l'interface, avec ancienne et nouvelle valeur — la base les conserve déjà.
- Vue par journée avec listes nominatives, heatmap à trois niveaux, tableau d'équité ventilé Jour et Nuit.
- Disponibilités habituelles réutilisables d'une campagne à l'autre.

### Lot 6 — Application installable ❌ à faire · taille **S**

Installation sur l'écran d'accueil du téléphone, fonctionnement hors ligne en consultation, notifications poussées.

### Hors périmètre V1

Échanges de garde entre agents, proposition automatique de planning, règles de repos, connexion par compte d'entreprise, intégrations externes.

---

## 4. Couverture du cahier des charges V1

| Exigence (§)                                   | État | Commentaire                                                    |
| ---------------------------------------------- | ---- | -------------------------------------------------------------- |
| Authentification (§18)                         | ✅   | Email et mot de passe                                          |
| Rôles et droits (§2)                           | 🟡   | Quatre rôles en base, deux dans l'interface                    |
| Fiche agent (§3)                               | 🟡   | Grade, matricule et téléphone manquants                        |
| Calendrier cinq états (§4)                     | 🟡   | Affiché ; la saisie ne s'enregistre pas encore                 |
| Saisie multiple et règles répétitives (§4)     | ✅   | Période, jours de semaine                                      |
| Disponibilités habituelles (§4)                | ❌   | Lot 5                                                          |
| Campagnes (§5)                                 | 🟡   | Lecture faite, création à raccorder                            |
| Tableau de synthèse (§6)                       | ✅   | Colonne figée, tri, filtres, virtualisé                        |
| Vue par journée nominative (§6)                | ❌   | Totaux présents, listes absentes                               |
| Besoins et couverture (§7)                     | 🟡   | Contrôlés en base ; saisie à raccorder                         |
| Planning et publication (§8)                   | 🟡   | Vérifiée et figée en base ; bouton à raccorder                 |
| Tableau d'équité (§8)                          | 🟡   | Total par agent, sans ventilation Jour/Nuit                    |
| Tableau de bord (§9)                           | 🟡   | Complet, sauf heatmap à trois niveaux                          |
| Notifications (§10)                            | 🟡   | Table prête, envoi absent                                      |
| Exports (§11)                                  | 🟡   | CSV et ICS faits ; Excel et PDF absents                        |
| Historique et audit (§12)                      | 🟡   | Conservé en base avec ancienne et nouvelle valeur ; non exposé |
| Modèle de données (§14)                        | ✅   | 17 tables déployées                                            |
| Sécurité et RGPD (§16)                         | 🟡   | Technique en place ; mentions et conservation à traiter        |
| Responsive et installable (§17)                | 🟡   | Adapté au mobile, non installable                              |
| Interface à plusieurs centaines d'agents (§21) | ✅   | Mesuré à 300 agents                                            |

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

| Risque                                            | Portée                     | Réduction                                                                        |
| ------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| Le lot 1 est le plus gros bloc restant            | Décalage du calendrier     | La logique métier est déjà écrite et testée ; il reste à la faire écrire en base |
| Deux responsables modifient le même planning      | Perte de modification      | La révision existe en base ; reste à traiter le conflit dans l'interface         |
| Aucun agent réel n'a encore utilisé l'application | Fonctionnalités inadaptées | Faire tester la saisie par deux ou trois agents dès le lot 1 terminé             |
| Le reste du cahier des charges s'accumule         | Périmètre qui s'étire      | Les lots 5 et 6 sont reportables sans empêcher l'usage                           |
| Un projet Supabase en veille                      | Indisponibilité            | Point 1 de la section précédente                                                 |

---

## 7. Comment vérifier l'état à tout moment

```sh
pnpm format:check   # mise en forme
pnpm lint           # qualité
pnpm typecheck      # types
pnpm test           # 41 tests unitaires et de base de données
pnpm build          # construction
pnpm test:e2e       # 16 tests de bout en bout
```

Ces six vérifications s'exécutent automatiquement à chaque modification envoyée sur le dépôt. Leur résultat est visible dans l'onglet Actions de GitHub.

---

## 8. Prochaine action

Vérifier que le mode connecté affiche bien les données du centre : exécuter `supabase/provisioning/premiere-campagne.sql`, puis lancer l'application en mode connecté et se connecter.

C'est le seul maillon de la chaîne actuelle qui n'a pas été observé en fonctionnement. Une fois confirmé, le lot 1 peut commencer.
