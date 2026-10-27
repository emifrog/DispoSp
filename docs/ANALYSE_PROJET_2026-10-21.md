# Analyse du projet DispoSP au 21 octobre 2026

## Conclusion

DispoSP couvre désormais un circuit plus complet : recueillir les disponibilités, préparer et publier les gardes, solliciter des remplaçants et alimenter un agenda personnel. Les lots A, B, C et D sont présents dans le dépôt. Le lot E, bilan mensuel historique consultable et transmissible, reste à développer ; ses données sources commencent à être capturées par les nouvelles migrations.

Cette analyse actualise la présentation et le guide des gestionnaires à partir de la version `ebc5177` et des changements depuis `84bf862`. Elle porte sur le code, les migrations, les tests locaux et la documentation. **Le porteur du projet confirme le 21 octobre que les cinq migrations des 20 et 21 octobre sont appliquées sur le site et les traitements planifiés activés.** Cette confirmation n'est pas un contrôle connecté effectué pendant l'analyse ; la réception des messages, les réglages de rappel du centre et la synchronisation réelle des logiciels d'agenda restent à vérifier.

## Évolutions constatées

| Domaine                      | État du dépôt et conséquence pour les utilisateurs                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traitements planifiés        | Génération SQL et livraison HTTP distinctes, files existantes réutilisées, suivi dans Paramètres et activation des rappels par centre.                              |
| Rappels                      | Garde la veille à l'heure choisie, 18 h par défaut ; relances de réponse à 48 h et 24 h de la clôture ; recontrôle des messages devenus obsolètes.                  |
| Photographies                | Capture à la publication, à la clôture effective et au début d'un créneau. Détails personnels séparés des faits statistiques ; scripts de retrait et purge adaptés. |
| Publication du mois          | Aperçu des créneaux prêts, bloqués et inchangés ; publication transactionnelle de la sélection prête ; récapitulatif par agent concerné.                            |
| Appels                       | Lancement depuis un désistement ou le planning, élargissement explicite, proposition de l'agent, sélection dans le brouillon et confirmation par publication.       |
| Disponibilité exceptionnelle | Après élargissement, déclaration précise pour une garde sans rouvrir la campagne ni réécrire sa réponse mensuelle.                                                  |
| Repos                        | Contrôle d'un repos au moins égal à la durée de la garde précédente ; Jour et Nuit de la même date traités comme une garde de 24 h.                                 |
| Agenda abonné                | Adresse privée générée une seule fois, révocable et remplaçable ; flux des gardes publiées encore tenues ; fenêtre de trois mois passés et douze mois à venir.      |
| Saisie et navigation         | Saisie rapide par période ou semaine type ; encadrement exclu des gardes et réponses attendues ; rubrique Désistements et accès Appels pour les agents.             |
| Bilan mensuel                | Pas encore de parcours de préparation, export ou envoi du bilan historique. Les statistiques actuelles restent fondées sur l'effectif courant.                      |

Les cinq nouvelles migrations examinées sont `20261020090000_traitements_planifies.sql`, `20261020150000_photographies.sql`, `20261020200000_publication_du_mois.sql`, `20261021090000_appels_remplacement.sql` et `20261021150000_agenda_abonne.sql`.

## Règles désormais explicites

- La date `closes_at` constitue la clôture définitive. Le verrouillage manuel est une pause réversible avant cette date et ne déclenche pas une photographie de clôture.
- La disponibilité exceptionnelle est conservée comme preuve pour une garde ; la sélection d'une proposition ne publie pas cette garde.
- Le repos fait partie des contrôles de candidature et de publication. Avec les horaires par défaut, une Nuit suivie du Jour du lendemain est refusée ; le Jour et la Nuit de la même date restent possibles sous forme de 24 h.
- Un retrait déjà annoncé par un désistement accepté ne produit pas un nouvel avis redondant lors de la publication du mois.
- Les emails de rappel, d'appel et de récapitulatif donnent les dates et horaires propres au destinataire. Le push reste discret sur l'écran verrouillé.
- Il n'existe pas de préférence individuelle générale d'email ou de rappel. L'activation push reste propre à l'appareil ; les rappels se règlent au niveau du centre.
- La décision inscrite le 20 octobre remplace le projet de seconde base hébergée : essais locaux, puis vérification progressive du site. Les documents mis à jour suivent cette décision.

## Vérifications réalisées

| Contrôle                     | Résultat de cette intervention                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tests locaux en Europe/Paris | **605 tests réussis dans 27 fichiers**, avec `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1`. |
| Types                        | `pnpm typecheck` réussi.                                                                                              |
| Lint                         | Aucune erreur ; un avertissement `react-hooks/incompatible-library` sur TanStack Table dans `availability-table.tsx`. |
| Compilation par défaut       | Non validée : échec interne Turbopack lors du lancement du processus chargé de transformer le CSS.                    |
| Vérification des documents   | Présentation de 6 pages et guide de 12 pages rendus avec Word, puis toutes les pages inspectées en images.            |
| Site et prestataires         | Aucun test connecté sur le site, aucun envoi réel, aucune modification de base hébergée pendant cette intervention.   |

Le lancement initial des tests avec les processus habituels ne terminait pas dans cet environnement. Le mode `threads` a permis l'exécution complète. Les tests de base utilisent PGlite avec une authentification simulée : leur réussite ne vaut pas recette de Supabase hébergé ni vérification de transactions réellement concurrentes.

La compilation a été essayée via le script habituel et via le lancement direct de Next.js, ainsi qu'une fois hors du bac à sable. L'erreur reste un arrêt du processus interne avant connexion à Turbopack, dans le traitement de `globals.css`. Cela ne prouve pas une erreur de syntaxe du CSS ni une panne du site ; cela empêche de déclarer la compilation par défaut réussie pendant cette analyse.

Un essai de diagnostic avec `next build --webpack` a ensuite atteint le chargement de la police Roboto, puis échoué sur la résolution réseau de `fonts.googleapis.com` (`ENOTFOUND`). Cette tentative ne valide donc pas non plus une compilation complète ; aucune configuration de compilation n'a été modifiée pour contourner ces échecs.

Les journaux de cette intervention sont conservés dans `.local/analyse-20261021-*`. Ils sont des preuves locales, pas des livrables destinés aux gestionnaires.

## Points restant à contrôler

### Priorité technique sur les publications simultanées

Le contrôle de repos est présent, mais sa protection contre deux publications simultanées sur **des créneaux différents** mérite une vérification dédiée. `private.publish_shift_version` verrouille la ligne du créneau publié ; `public.publish_month` verrouille les créneaux de sa campagne. Dans les chemins examinés, aucun verrou commun par agent ne sérialise les publications de campagnes différentes.

Scénario à reproduire sur PostgreSQL avec deux connexions : le même agent est au brouillon d'une Nuit et du Jour suivant, sur deux campagnes distinctes. Les transactions vérifient le repos avant que l'autre ait validé sa publication. Des verrous sur deux créneaux distincts ne suffisent pas à faire attendre l'une après l'autre. Une protection commune ou une autre garantie transactionnelle doit être démontrée.

Il s'agit d'un **risque déduit de la lecture du code, non reproduit avec deux sessions lors de cette intervention**. Les tests séquentiels de repos ne le couvrent pas à eux seuls. Ne pas annoncer une garantie absolue sur les publications concurrentes avant ce contrôle. Repères : migration `20261021090000_appels_remplacement.sql`, fonctions `private.rest_violation`, `private.publish_shift_version` et `public.publish_month`.

### Mise en service et synchronisation réelles

L'application des cinq migrations et l'activation des traitements planifiés sont confirmées par le porteur du projet. La vérification restante porte sur la version applicative effectivement déployée, les derniers passages réussis de génération et de livraison, le réglage des rappels dans Paramètres et la réception réelle. L'activation technique des traitements ne prouve pas à elle seule que chaque centre a activé ses rappels ni que les messages sont reçus.

L'agenda est testé comme flux et comme route, mais son usage nécessite une recette Apple Calendrier, Google Agenda et, si retenu, Outlook : création, changement d'horaire, retrait et révocation. Le code retire une garde du flux sans conserver d'événement annulé ; observer comment chaque client applique ce retrait. Une révocation n'efface pas nécessairement les événements déjà stockés dans le logiciel de l'agent.

### Statistiques et conservation

Les photographies constituent un progrès réel, mais ne changent pas encore le calcul de l'écran Statistiques. Ne pas le présenter comme un bilan historique stabilisé. L'historique démarre à l'installation de la migration et ne permet pas de promettre une reconstitution complète du passé.

Les faits statistiques restent conservés selon leur échéance propre, alignée par défaut sur celle des campagnes. Leur absence de nom ne suffit pas à démontrer leur anonymat dans un petit centre. L'état de validation des règles de conservation et du dossier RGPD n'a pas été vérifié pendant cette intervention.

### Documentation technique à harmoniser

Les sections détaillées du README décrivent les nouveaux lots, mais son introduction et certaines sections anciennes restent en décalage :

- La publication est encore décrite uniquement par créneau dans la liste initiale ; les appels ne sont pas intégrés à la description initiale des désistements.
- La clé secrète Supabase est présentée comme réservée à l'invitation, alors que `src/app/api/traitements/route.ts` l'utilise désormais pour le traitement serveur. Il faut documenter ce périmètre réel sans exposer la clé.
- La spécification conserve des formulations du 17 octobre indiquant que la déclaration exceptionnelle n'existe pas encore ou que le repos reste à décider, alors que les décisions des 20 et 21 octobre et le code les remplacent.
- Le plan de développement doit distinguer les lots présents dans le dépôt des opérations réellement activées sur le site.

Ces documents de développement n'ont pas été réécrits dans cette intervention, centrée sur la présentation et le guide. Leur harmonisation évitera qu'une prochaine modification parte d'une règle périmée.

## Documents actualisés

- `output/docx/Dossier_presentation_DispoSP.docx` : présentation de 6 pages, datée du 21 octobre ; retrait des constats obsolètes de septembre et présentation des nouveaux parcours.
- `output/pdf/Dossier_presentation_DispoSP.pdf` : même présentation, prête à diffuser.
- `output/docx/DispoSP_Guide_gestionnaires_2026-10-21.docx` : guide de 12 pages avec publication mensuelle, règle de repos, remplacement après clôture, rappels, agenda et dépannage.

Le guide du 8 octobre est conservé comme édition antérieure. Aucun code applicatif ni migration n'a été modifié.

## Sources principales du dépôt

- `src/components/planning.tsx`, `calls.tsx`, `calendar-subscription.tsx`, `management.tsx`, `shell.tsx`, `availability.tsx` et `statistics.tsx`.
- `src/app/api/traitements/route.ts`, `src/app/api/agenda/route.ts` et `src/app/api/agenda/[jeton]/route.ts`.
- Les cinq migrations des 20 et 21 octobre et les scripts associés de provisionnement, retrait et purge.
- Les tests des routes, commandes et règles de base, le README et les décisions ajoutées à la spécification opérationnelle.
