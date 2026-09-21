# Contrôle responsive DispoSP — 21 septembre 2026

Version : **4c5dbcb**, après les commits A3, A5, chargement et responsive.

**Verdict : l’application s’adapte correctement sur les écrans principaux testés, mais deux défauts empêchent de la considérer entièrement responsive.** Le menu doit rester accessible sur un écran peu haut ; la création de campagne doit tenir dans une fenêtre mobile étroite.

## Méthode et limites

Les variables E2E_EMAIL et E2E_PASSWORD existent localement mais sont vides. Aucun compte de test connecté n’a donc pu être utilisé. Aucun envoi d’email ni aucune donnée métier n’a été modifié.

- Pages publiques : rendues par le serveur Next.js local de la version actuelle, dans Chromium.
- Écrans métier : vrais composants React, vrai provider, vraie structure de navigation et CSS compilé par Next.js, rendus dans un banc local isolé. Données fictives : douze agents, campagne, disponibilités, affectations, publication, invitation, demande et notification. Navigation Next, images et action serveur adaptées au banc ; les écritures sont simulées et ne touchent jamais Supabase.
- Habillage de gestion testé avec le rôle ADMIN, qui affiche toutes les rubriques ; parcours personnels également testés avec le rôle AGENT. Le rôle GESTIONNAIRE n’a pas fait l’objet d’une session distincte.
- Inspection des dimensions, débordements, contrôles, filtres et captures, avec vérification visuelle d’un calendrier mobile, d’un planning tablette, de la matrice ordinateur, de la connexion, du chargement et des deux défauts.
- Chromium uniquement : Safari/iOS, Firefox, clavier virtuel réel, encoche et installation PWA sur appareil physique restent à contrôler. Une fenêtre basse simule l’espace réduit, pas le comportement réel d’un clavier mobile.

Ce contrôle concerne la présentation. Il ne certifie ni les parcours Auth réels ni les corrections métier A3/A5 annoncées.

## R1 — Priorité haute : des rubriques du menu deviennent inaccessibles

**Reproduit à 320 × 568, 844 × 390, 1 024 × 768 et 1 280 × 600.** La barre latérale est fixe, sa hauteur suit la fenêtre, mais elle n’a pas de défilement vertical. Ses dernières rubriques dépassent le bas de l’écran.

À 844 × 390, huit liens sont partiellement ou totalement sous l’écran : Planning, Besoins, Campagnes, Agents & équipes, Demandes, Statistiques, Historique et Paramètres. Après une tentative de défilement à la souris dans le menu, scrollTop reste à zéro et le début de Paramètres se trouve vers y = 766 px. À 1 024 × 768, Paramètres est déjà partiellement masqué.

Référence : [globals.css, .sidebar](E:/GitHub/DispoSp/src/app/globals.css:119).

**Correction proposée :** rendre la barre latérale défilable verticalement, ou donner un espace défilant à sa navigation avec une hauteur contrainte. Vérifier l’accès effectif au dernier lien au toucher et au clavier, en menu mobile ouvert comme en navigation ordinateur.

![Menu en paysage : les rubriques du bas sont hors écran](E:/GitHub/DispoSp/docs/audits/responsive-2026-09-21/menu-paysage.png)

## R2 — Priorité moyenne : le formulaire de campagne déborde à 320 px

**Reproduit dans « Nouvelle campagne » à 320 × 568.** La fenêtre fait 290 px de large, mais son contenu dépasse horizontalement de **29 px**. Le libellé et le champ « Clôture des réponses » sont coupés sur la droite. Le débordement global de la page reste nul : le test actuel ne détecte donc pas ce défaut intérieur.

Références : [grille du formulaire](E:/GitHub/DispoSp/src/components/management.tsx:162), [CSS .form-grid](E:/GitHub/DispoSp/src/app/globals.css:1535), [conteneur de fenêtre](E:/GitHub/DispoSp/src/app/globals.css:1500).

**Correction proposée :** passer les deux champs sur une seule colonne sur les petits écrans, et contraindre leur largeur minimale. Ajouter un contrôle du débordement interne et de l’accès aux champs des fenêtres ouvertes.

![Champ de clôture coupé dans une fenêtre de 320 px](E:/GitHub/DispoSp/docs/audits/responsive-2026-09-21/campagne-320.png)

## Ce qui fonctionne dans les cas testés

| Périmètre                              | Vérification                                                                                           | Résultat                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 15 écrans métier, habillage de gestion | 11 dimensions par écran, soit 165 combinaisons                                                         | Aucun débordement horizontal global ; aucune cible mesurée sous 24 × 24 px parmi les commandes contrôlées     |
| Parcours agent                         | Accueil, disponibilités, planning personnel, profil et notifications sur quatre dimensions             | Aucun débordement global                                                                                      |
| Pages publiques réelles                | Connexion, hors ligne, activation sans session, nouveau mot de passe sans session, sur cinq dimensions | Aucun débordement global                                                                                      |
| Fenêtres de saisie                     | Invitation, équipe, campagne, saisie rapide, besoins en lot, besoin unitaire, fiche agent, désistement | Défilement vertical disponible ; seul le formulaire de campagne présente le débordement horizontal identifié  |
| Filtres                                | Matrice et historique à 320, 414 et 768 px                                                             | Les options mesurées tiennent dans les sélecteurs                                                             |
| Statistiques                           | Onglets jours de semaine et agents à 320 px                                                            | Aucun débordement global                                                                                      |
| Textes longs                           | Noms de centre, d’agent et d’équipe rallongés sur trois écrans                                         | Aucun débordement global sur les largeurs contrôlées                                                          |
| Chargement                             | Spinner, barre d’attente lors d’une action simulée et fin d’attente                                    | Indicateurs visibles ; rôles de statut présents ; animation du spinner désactivée avec les mouvements réduits |

Dimensions principales, en pixels CSS : **320 × 800, 375 × 812, 390 × 844, 414 × 896, 768 × 1 024, 820 × 1 180, 1 024 × 768, 1 280 × 800, 1 440 × 1 000, 1 920 × 1 080, 844 × 390**. Les essais complémentaires comprennent notamment 320 × 568 et 390 × 400 pour les fenêtres.

Le défilement horizontal contenu dans une grande matrice est volontaire et ne constitue pas un débordement global de page. Les mesures de 24 px ne constituent pas une certification d’accessibilité : elles ne valident pas, à elles seules, les contrastes, le focus ou tous les usages tactiles.

## Renforcer les tests existants

[responsive.spec.ts](E:/GitHub/DispoSp/tests/e2e/responsive.spec.ts:78) ignore les parcours métier sans identifiants. De plus, un compte agent peut rencontrer une page « Espace responsable » sur les routes de gestion : ses dimensions ne valident pas celles de l’écran attendu.

À ajouter :

1. Des sessions agent et gestionnaire identifiées et une assertion du véritable écran atteint avant les mesures.
2. L’ouverture des fenêtres de saisie et le contrôle de leur contenu, au-delà de la largeur du document.
3. Des fenêtres de faible hauteur et une vérification de l’accès au dernier lien du menu.
4. Une recette Safari/iPhone et Android, avec clavier virtuel ouvert.

Les scripts et résultats détaillés de cette revue restent dans le dossier local ignoré [.local/responsive-20260921](E:/GitHub/DispoSp/.local/responsive-20260921). Aucune correction applicative n’a été appliquée dans cette revue.
