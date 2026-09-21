# DispoSP — Décisions fonctionnelles complémentaires

Date : 18 septembre 2026

Ce document complète le cahier des charges V1.0 du 17 septembre 2026. Il distingue les décisions confirmées des propositions restant à valider. Les horaires illustrés dans les maquettes ne font pas référence lorsqu'ils contredisent les décisions ci-dessous.

## 1. Décisions confirmées

### Horaires des créneaux

- Jour : de 08:00 à 20:00.
- Nuit : de 20:00 à 08:00 le lendemain.

Ces horaires remplacent les indications 07:00–19:00 et 19:00–07:00 des maquettes.

Le caractère configurable des horaires, le rattachement d'une nuit à une date et la portée exacte d'une disponibilité « 24 h » ont été retenus à la suite de l'accord de démarrage ; voir la section 2.

### Réponse à une campagne

Un agent est considéré comme ayant répondu après validation explicite de sa réponse à la campagne. La seule saisie ou sauvegarde de disponibilités ne suffit pas.

Conséquences fonctionnelles :

- Prévoir une action explicite « Valider mes disponibilités ».
- Distinguer la progression de saisie, exprimée en jours renseignés, de la validation de la réponse.
- Un agent ayant renseigné tous les jours mais n'ayant pas validé ne compte pas comme répondant.
- Calculer le taux de réponse à partir des agents ayant validé, rapporté aux agents concernés par la campagne.
- Une indisponibilité explicite constitue une journée renseignée ; une absence de saisie reste une journée non renseignée.

Restent à définir : possibilité de valider une réponse incomplète et effet d'une modification après validation.

### Couverture potentielle et couverture planifiée

Les deux mesures sont distinctes et doivent être nommées explicitement dans le tableau de bord, les synthèses et les exports qui les présentent.

| Mesure                 | Données comparées aux besoins                    | Signification                   |
| ---------------------- | ------------------------------------------------ | ------------------------------- |
| Couverture potentielle | Disponibilités déclarées éligibles               | Effectif pouvant être mobilisé. |
| Couverture planifiée   | Affectations retenues dans le planning considéré | Effectif effectivement affecté. |

Exemple : pour un besoin de huit agents, huit agents disponibles et six affectés donnent une couverture potentielle de 8/8 et une couverture planifiée de 6/8, avec deux affectations manquantes.

Conséquences fonctionnelles :

- Ne jamais déduire une affectation d'une disponibilité.
- Toujours indiquer la mesure utilisée par un compteur, une alerte ou une carte de couverture.
- Préciser le planning considéré lorsqu'une mesure porte sur un brouillon ou sur une version publiée.
- Présenter séparément la couverture en effectifs et celle en qualifications : atteindre le nombre total requis ne prouve pas que toutes les qualifications sont couvertes.

Restent à définir : inclusion des disponibilités non encore validées dans la couverture potentielle et statuts d'affectation comptabilisés dans la couverture planifiée.

## 2. Règles retenues au démarrage : date et couverture des créneaux

Règles retenues :

- Horaires configurables par organisation, initialisés à 08:00–20:00 et 20:00–08:00.
- Une nuit est rattachée à sa date de début.
- Une disponibilité « 24 h » à la date D s'étend de 08:00 à D jusqu'à 08:00 à D+1.
- Cette disponibilité rend l'agent disponible pour le créneau Jour de D et le créneau Nuit de D ; elle ne crée aucune affectation automatiquement.
- Un agent disponible 24 h compte une seule fois dans l'effectif potentiel de chacun de ces deux créneaux. Il ne doit pas être additionné deux fois au sein d'un même créneau.

Exemple pour le 15 octobre 2026 :

| Déclaration        | Début              | Fin                | Besoins potentiellement couverts |
| ------------------ | ------------------ | ------------------ | -------------------------------- |
| Jour du 15 octobre | 15 octobre à 08:00 | 15 octobre à 20:00 | Jour du 15 octobre               |
| Nuit du 15 octobre | 15 octobre à 20:00 | 16 octobre à 08:00 | Nuit du 15 octobre               |
| 24 h du 15 octobre | 15 octobre à 08:00 | 16 octobre à 08:00 | Jour et Nuit du 15 octobre       |

Ces règles servent de référence à la première version.

## 3. Adaptations à prévoir dans les maquettes

- Remplacer les horaires des légendes, choix de disponibilité, cartes de garde et écrans de construction.
- Afficher le statut de réponse à la campagne indépendamment du pourcentage de jours renseignés.
- Ajouter l'action de validation explicite et son retour de confirmation.
- Remplacer les indicateurs génériques de couverture par des libellés précisant « potentielle » ou « planifiée ».
- Conserver la séparation entre disponibilité déclarée et affectation au planning.

## 4. Scénarios de recette issus des décisions confirmées

1. Un agent remplit les 31 jours d'une campagne sans valider : sa progression est de 31/31, mais il n'est pas compté comme répondant.
2. Cet agent valide explicitement : il est alors compté comme répondant.
3. Pour huit agents requis, huit disponibles et six affectés : afficher 8/8 en potentiel et 6/8 en planifié.
4. Un agent passe de disponible à affecté : sa disponibilité et son affectation restent deux informations séparées.
5. Les écrans utilisent les horaires confirmés de 08:00–20:00 et 20:00–08:00 au lieu des horaires initiaux des maquettes.

## 5. Hypothèses de travail de la première version

Ces choix ont été annoncés au démarrage du développement. Ils sont modifiables et ne constituent pas de nouvelles demandes explicites du porteur de projet :

- Tous les jours doivent être renseignés pour valider une réponse.
- Toute modification ou suppression d'une disponibilité invalide la réponse à la campagne entière.
- Seules les réponses validées alimentent la couverture potentielle et la liste des agents affectables.
- La couverture planifiée du tableau de bord porte sur le brouillon. Le planning personnel contient uniquement les publications.
- La publication se fait par créneau. Elle est bloquée si l'effectif, les qualifications ou l'éligibilité des agents sont insuffisants.
- Les modifications du brouillon ne changent pas la version publiée avant une republication explicite.
- Une personne peut satisfaire plusieurs minima de qualification, mais compte une seule fois dans l'effectif. La couverture de postes opérationnels exclusifs reste à définir.
- Les horaires modifiés s'appliquent aux nouvelles campagnes ; les campagnes existantes conservent leurs horaires.
- Le fuseau de référence est Europe/Paris ; une nuit peut avoir une durée réelle différente lors du changement d'heure.

> **Mise à jour du 19 septembre 2026.** Le mode démonstration et son stockage local ont été retirés : l'application ne tourne plus que branchée sur Supabase, et le schéma n'est plus un socle séparé mais la source de toutes les données affichées. Deux décisions prises depuis complètent celles ci-dessus, sans les contredire :
>
> - **Trois rôles au lieu de quatre.** `RESPONSABLE` est retiré. Un gestionnaire n'est plus tenu à son équipe, il gère tout son centre ; seul un administrateur change un rôle, et personne ne change le sien. Les comptes concernés sont passés gestionnaires.
> - **Le grade et la fonction sont deux choses.** Le grade se gagne à l'ancienneté et suit la personne ; la fonction se tient sur un engin. Ils étaient confondus dans un champ unique, ce qui obligeait à renoncer à l'un des deux.
