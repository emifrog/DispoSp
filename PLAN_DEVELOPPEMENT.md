# Plan de développement — DISPO SP

État au 18 septembre 2026. Ce document recense ce qui est fait, ce qui reste, et ce qu'il faut précisément pour qu'un centre puisse utiliser l'application avec de vrais agents.

Il complète le cahier des charges V1.0 du 17 septembre 2026 et `DECISIONS_FONCTIONNELLES.md`, qui restent la référence fonctionnelle.

---

## 1. Où en est le projet

L'application existe en deux modes. Le premier est une **démonstration locale** complète : les dix écrans fonctionnent, les données vivent dans le navigateur, aucun compte n'est nécessaire. Le second est le **mode connecté** : l'utilisateur s'authentifie, les écrans lisent la base de données réelle, et **la saisie s'y enregistre**.

Le parcours complet a été observé sur un centre réel : un agent renseigne son mois, valide sa réponse, un responsable définit les besoins, affecte, publie, et l'agent retrouve sa garde. Un administrateur crée désormais les agents depuis l'application, sans passer par le SQL.

L'application est déployée sur Vercel, mais **en mode démonstration** : le site public affiche les douze agents fictifs et ne demande aucun compte. Basculer le déploiement en mode connecté et déclarer l'adresse publique dans Supabase sont les deux gestes qui séparent l'état actuel d'un vrai usage.

### Avancement par domaine

| Domaine                 | État       | Détail                                                  |
| ----------------------- | ---------- | ------------------------------------------------------- |
| Socle technique         | ✅ terminé | Versionnement, formatage, lint, intégration continue    |
| Base de données         | ✅ terminé | 18 tables déployées, droits et règles vérifiés          |
| Authentification        | ✅ terminé | Connexion, session, déconnexion                         |
| Lecture des données     | ✅ terminé | Les écrans lisent la base                               |
| Écriture des données    | ✅ terminé | Les huit commandes écrivent en base, sous RLS           |
| Historique et audit     | ✅ terminé | Journal tenu par la base, lisible et filtrable          |
| Administration          | ✅ terminé | Agents, équipes, rôles et qualifications depuis l'écran |
| Notifications           | 🟡 partiel | La table existe, aucun email n'est envoyé               |
| Exports                 | 🟡 partiel | CSV et ICS faits, Excel et PDF absents                  |
| Application installable | ❌ à faire | Le site est adapté au mobile, mais non installable      |
| Hébergement             | 🟡 partiel | Déployé sur Vercel, mais en mode démonstration          |

### Ce qui est solide

Le socle de données porte les règles métier, et il est plus strict que l'interface. Publier un créneau déclenche une vérification en base de l'effectif, des qualifications et de l'éligibilité de chaque agent ; un agent affecté sans disponibilité validée fait échouer la publication. Le brouillon du responsable et la version publiée sont deux choses distinctes : modifier le brouillon ne change pas ce que les agents voient. Aucune session cliente ne peut écrire une version publiée.

L'invalidation d'une réponse après modification est elle aussi tenue par la base : modifier un jour remet la réponse « à valider » sans que l'interface ait à y penser. Le journal d'audit est écrit par des déclencheurs, jamais par le navigateur : aucune session ne peut forger ni omettre une ligne.

Ces garanties tiennent même si l'interface se trompe, ce qui est le bon endroit pour les placer.

### Mesure de la qualité

|                                     | Valeur                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| Tests automatisés                   | 63 unitaires, 16 de bout en bout                                     |
| Vérifications à chaque modification | 6, exécutées automatiquement                                         |
| Tenue en charge mesurée             | 300 agents : ~25 lignes affichées au lieu de 300, 13 ms par commande |

---

## 2. Le chemin critique vers une première utilisation

Tout n'est pas également urgent. Voici ce qui **empêche réellement** un centre de se servir de l'application, par ordre de dépendance.

| #     | Verrou                                 | Pourquoi c'est bloquant                     | Lot       |
| ----- | -------------------------------------- | ------------------------------------------- | --------- |
| ~~1~~ | ~~Les saisies ne s'enregistrent pas~~  | Levé le 18 septembre 2026                   | ~~Lot 1~~ |
| ~~2~~ | ~~Aucun écran pour créer un agent~~    | Levé le 18 septembre 2026                   | ~~Lot 2~~ |
| ~~3~~ | ~~Pas de grade ni de matricule~~       | Levé le 18 septembre 2026                   | ~~Lot 2~~ |
| 4     | Personne n'est prévenu d'une campagne  | Sans email, le taux de réponse s'effondre   | Lot 3     |
| 5     | Le déploiement tourne en démonstration | Le site public ne montre pas le vrai centre | Lot 4     |

**Les lots 3 et 4 constituent le minimum utilisable restant.** Tout le reste — exports Excel et PDF, installation sur l'écran d'accueil — améliore l'usage sans le conditionner.

Le verrou 5 ne demande plus de développement, mais deux réglages : la variable de mode dans Vercel, suivie d'un redéploiement, et l'adresse publique déclarée dans la configuration d'authentification de Supabase. Sans cette seconde, le lien de confirmation envoyé à un agent invité pointe vers `localhost` et le rattachement ne se déclenche jamais.

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

### Lot 2 — Agents et administration ✅ terminé

- Grade, matricule et téléphone portés par la fiche agent, exigés au §3. Le grade stocké peut rester vide ; c'est l'affichage qui retombe alors sur le rôle, et non le contraire — sans quoi le premier enregistrement inscrirait le libellé de repli en base.
- Écran d'administration : inviter, modifier une fiche, muter, changer de rôle, désactiver et réactiver, attribuer des qualifications, créer et renommer des équipes.
- Les quatre rôles du §2 dans l'interface. Un responsable d'équipe ne voit plus les deux écrans d'administration, qui lui auraient répondu par un refus.
- Historique filtrable par sujet, par auteur et par recherche libre.

L'invitation remplace le script SQL **sans aucune clé secrète**. Un administrateur enregistre qui est attendu ; l'agent crée son propre compte avec son propre mot de passe, et un déclencheur le rattache à la confirmation de son adresse — une adresse non confirmée n'occupe jamais de place. L'envoi de l'email reste au lot 3 ; d'ici là, l'administrateur transmet l'adresse de l'application.

La migration `0004_agent_administration.sql` ouvre ce que `0001` et `0002` gardaient fermé, et pose la règle qu'un droit de colonne ne sait pas exprimer : personne ne change son propre rôle, seul un administrateur change un rôle, personne ne se désactive soi-même.

Une réserve : l'acceptation d'une invitation n'a pas encore été observée de bout en bout, faute d'un second compte.

### Lot 3 — Notifications ❌ à faire · taille **M**

- Envoi des emails à l'ouverture d'une campagne, en rappel avant clôture, et à la publication d'un planning.
- Centre de notifications dans l'application ; la table existe déjà et se remplit à la publication.
- Choix d'un service d'envoi et configuration du domaine expéditeur.

### Lot 4 — Mise en service ❌ à faire · taille **S**

- Basculer le déploiement Vercel en mode connecté, et déclarer l’adresse publique dans la configuration d’authentification de Supabase. Nom de domaine propre à choisir.
- Vérification du plan Supabase : un projet gratuit se met en veille après inactivité, ce qui est incompatible avec un usage réel.
- Mentions légales, information des agents, durée de conservation des données.
- Sauvegardes et procédure de restauration vérifiée.

### Lot 5 — Exports et confort ❌ à faire · taille **M**

- Exports Excel et PDF du planning et de la synthèse.
- Historique consultable par période, et export du journal. Le filtrage par sujet et par auteur est fait.
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
| Rôles et droits (§2)                           | ✅   | Les quatre rôles, en base et dans l’interface           |
| Fiche agent (§3)                               | ✅   | Grade, matricule et téléphone ; création par invitation |
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
| Historique et audit (§12)                      | ✅   | Écrit par la base, filtrable par sujet et par auteur    |
| Modèle de données (§14)                        | ✅   | 18 tables déployées, quatre migrations                  |
| Sécurité et RGPD (§16)                         | 🟡   | Technique en place ; mentions et conservation à traiter |
| Responsive et installable (§17)                | 🟡   | Adapté au mobile, non installable                       |
| Interface à plusieurs centaines d'agents (§21) | ✅   | Mesuré à 300 agents                                     |

---

## 5. À décider, hors développement

Ces points ne relèvent pas du code, et conditionnent la mise en service.

1. **Plan Supabase.** Un projet gratuit se met en veille après inactivité. À trancher avant que des agents en dépendent.
2. **Nom de domaine.** L'application tourne sur Vercel ; reste à décider sous quel nom, et qui en a la charge.
3. **Service d'envoi d'emails.** Nécessaire au lot 3, avec un domaine expéditeur vérifié. D'ici là, l'administrateur transmet lui-même l'adresse de l'application à l'agent qu'il invite.
4. **Procédure d'entrée et de sortie.** Le mécanisme existe — invitation, puis inscription par l'agent — mais qui invite, et que fait-on d'un agent qui part : désactivé, ce qui le sort des synthèses et des viviers, ou effacé, ce qui relève du point 5.
5. **RGPD.** Information des agents, base légale, durée de conservation, procédure d'effacement. Une suppression de compte est aujourd'hui bloquée par les contraintes de la base — c'est volontaire, mais il faut décider de la marche à suivre.
6. **Périmètre de la première mise en service.** Un centre pilote, ou tous d'emblée.

---

## 6. Risques

| Risque                                            | Portée                     | Réduction                                                                           |
| ------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Une création de campagne échoue à mi-chemin       | Campagne incomplète        | Quatre requêtes sans transaction ; à déplacer derrière une fonction de base         |
| Deux responsables modifient le même planning      | Perte de modification      | La révision existe en base ; reste à traiter le conflit dans l'interface            |
| Aucun agent réel n'a encore utilisé l'application | Fonctionnalités inadaptées | Le parcours complet tient sur un compte ; le faire essayer par deux ou trois agents |
| Le déploiement public affiche la démonstration    | Confusion                  | Deux réglages, sans développement ; voir le verrou 5 du chemin critique             |
| L'acceptation d'une invitation n'a jamais tourné  | Arrivées bloquées          | Éprouvée sur un vrai moteur, jamais sur le projet hébergé ; à tester en premier     |
| Le reste du cahier des charges s'accumule         | Périmètre qui s'étire      | Les lots 5 et 6 sont reportables sans empêcher l'usage                              |
| Un projet Supabase en veille                      | Indisponibilité            | Point 1 de la section précédente                                                    |

---

## 7. Comment vérifier l'état à tout moment

```sh
pnpm format:check   # mise en forme
pnpm lint           # qualité
pnpm typecheck      # types
pnpm test           # 63 tests unitaires et de base de données
pnpm build          # construction
pnpm test:e2e       # 16 tests de bout en bout
```

Ces six vérifications s'exécutent automatiquement à chaque modification envoyée sur le dépôt. Leur résultat est visible dans l'onglet Actions de GitHub.

---

## 8. Prochaine action

Faire aboutir une invitation sur le projet hébergé.

Trois gestes, dans cet ordre : basculer `NEXT_PUBLIC_DISPOSP_MODE` sur `connected` dans Vercel et redéployer ; déclarer l'adresse publique dans **Supabase → Authentication → URL Configuration** ; puis s'inscrire avec l'adresse invitée et confirmer.

C'est le dernier maillon jamais observé en fonctionnement. Il est éprouvé sur un moteur PostgreSQL réel, mais la création d'un compte `auth` demande un vrai parcours d'inscription, que les tests ne peuvent pas jouer. Si l'historique affiche alors « Invitation acceptée » **au nom de l'agent** et non du sien, tout le mécanisme tient.

Ce même geste donne le deuxième compte qui manque depuis le début : la synthèse, la couverture et l'équité ne disent rien d'utile à un contre un, et personne n'a encore essayé la saisie sans avoir écrit l'application.
