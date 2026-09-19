# Analyse du projet DispoSP — 19 septembre 2026

Version examinée : commit **849291b** sur **main**, arbre de travail propre au début de l’analyse.

DispoSP couvre désormais une grande partie de la V1. Les évolutions sont substantielles : application exclusivement connectée, trois rôles, grade et fonction séparés, modèles de disponibilité atomiques, besoins en lot, statistiques, désistements, exports et PWA. Toutefois, la mise en service ne se réduit pas à la configuration de l’hébergement : plusieurs défauts de droits et de cohérence métier restent à corriger.

## Suivi des correctifs — commit 2abab2e

Les sections numérotées ci-dessous conservent les constats et les résultats de l’audit initial du commit **849291b**. Les références de lignes historiques peuvent avoir changé. Le tableau suivant indique leur statut après relecture des correctifs ; il prévaut sur les formulations initiales.

| Constat          | Statut vérifié                                                                                                                                                                                                | Limite restante                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 — Invitations | Corrigé dans le dépôt : le rôle ADMIN exige un administrateur à l’insertion comme à la modification ; le formulaire filtre les rôles proposés. Quatre tests PostgreSQL couvrent les refus et les permissions. | Application de la nouvelle migration sur la base hébergée non vérifiée lors de cette revue.                                                         |
| A6 — Besoins     | Corrigé par créneau : public.set_staffing_requirement() regroupe effectif, catalogue et minima dans une transaction sous les droits de l’appelant. Le test de refus conserve les minima précédents.           | Le lot reste partiel en cas d’échec ; le provider ne recharge toujours pas les données après un refus. Le résultat partiel doit être rendu visible. |
| A3 — Lectures    | Partiellement corrigé : chaque résultat est contrôlé ; une erreur lève avec un message générique, une absence conserve le repli attendu, dont null pour l’organisation. Deux tests du garde couvrent ces cas. | Aucune pagination ajoutée. Une réponse tronquée sans erreur peut encore être présentée comme complète.                                              |
| A7 — CI          | Un correctif supplémentaire est présent dans l’arbre de travail : routes publiques accessibles sans configuration Supabase, six tests du garde ajoutés.                                                       | Changements non commités au moment de la vérification ; workflow GitHub et parcours navigateur complets non rejoués ici.                            |
| A2, A4, A5       | Toujours ouverts dans le périmètre examiné.                                                                                                                                                                   | Parcours d’entrée, population de campagne et éligibilité à la publication à traiter.                                                                |

**Vérification exécutée pendant ce suivi : 151 tests réussis dans 8 fichiers.** Ce total inclut les 145 tests du commit annoncé et les six tests A7 présents pendant l’exécution. Typecheck, lint, formatage et build du correctif sont annoncés réussis par l’auteur ; ils n’ont pas été relancés ici. Les résultats navigateur de l’audit initial restent historiques.

La migration concernée est [20260920090000_correctifs_droits_et_besoins.sql](E:/GitHub/DispoSp/supabase/migrations/20260920090000_correctifs_droits_et_besoins.sql). Sa présence et son exécution dans les tests locaux ne certifient pas son déploiement sur Supabase. Les anciens diagnostics locaux reproduisant A1, A6 et les erreurs de lecture décrivent la version antérieure ; ils ne constituent pas les tests de non-régression actuels.

**Ordre de travail actualisé :** terminer la vérification A7, puis traiter la pagination restante d’A3 et les chantiers A2, A4 et A5. Le choix du parcours A2 reste à décider ; la pagination ne doit pas disparaître du suivi après la correction des erreurs de lecture. Prévoir également le retour explicite des écritures en lot partiellement réussies.

## Périmètre et niveau de preuve

L’analyse porte sur le cahier des charges V1.0, les décisions fonctionnelles, les huit maquettes, le plan, la recette, les principaux parcours et composants, la lecture/écriture des données, les onze migrations et les tests. Le PDF initial prévoit quatre rôles ; leur réduction à trois est consignée dans les décisions du 19 septembre et n’est donc pas traitée comme une régression.

Les migrations sont déclarées appliquées dans la documentation du projet. Je n’ai ni interrogé ni modifié la base Supabase hébergée pour cet audit. Les configurations Auth, SSO, SMTP, Resend, sauvegardes et hébergement ne sont pas certifiées ici. Aucun email n’a été envoyé et aucun compte réel n’a été créé.

Les défauts SQL ont été reproduits avec les onze migrations dans PostgreSQL embarqué via PGlite, avec des comptes fictifs. Trois autres diagnostics isolés vérifient le comportement de lecture, le calcul entre équipes et les prérequis des pages publiques. Ces diagnostics reproduisent des défauts ; leur réussite ne signifie pas que ces défauts sont corrigés. Ils restent dans le dossier local ignoré .local/audit-20260919/. Aucun code applicatif ni migration n’a été modifié.

## 1. Résultat des vérifications

| Vérification exécutée                    | Résultat                     | Portée                                                                           |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| Formatage du dépôt                       | Réussi                       | Avant ajout de ce rapport                                                        |
| Lint                                     | 0 erreur, 1 avertissement    | TanStack Table et React Compiler, availability-table.tsx:110                     |
| Types TypeScript                         | Réussi                       | Projet actuel                                                                    |
| Tests métier, exports, commandes et base | **135 réussis**, 7 fichiers  | Auth émulée pour les tests PostgreSQL                                            |
| Build de production                      | Réussi                       | Environnement local configuré ; avertissement de dépréciation middleware → proxy |
| Tests navigateur                         | **6 réussis, 12 ignorés**    | Manifeste/icônes, hors-ligne, dimensions des pages publiques                     |
| Diagnostics supplémentaires              | **7 constats reproduits**    | 4 SQL et 3 diagnostics applicatifs isolés                                        |
| Rendu mobile                             | Connexion inspectée à 390 px | Écrans métier non inspectés dans une session authentifiée                        |

Les 12 tests navigateur ignorés correspondent à 8 variantes de connexion conditionnées par une variable d’environnement, 2 tests d’installation du profil sans compte E2E et 2 doublons desktop volontairement ignorés pour les contrôles mobiles. Next charge le fichier .env local, mais la condition de saut des tests lit l’environnement du processus Playwright : les deux ne sont pas automatiquement identiques.

**La suite ne vérifie plus automatiquement le parcours navigateur disponibilité → validation → affectation → publication depuis le retrait de l’ancienne démonstration.** Les tests de fonctions et de base restent utiles, mais ne remplacent pas ce parcours.

## 2. Constats à traiter avant une mise en service

### A1 — P1 : un gestionnaire peut créer un administrateur par invitation

**Reproduit en base.** Un compte GESTIONNAIRE insère une invitation portant le rôle ADMIN. À la confirmation de l’adresse du compte invité, le déclencheur lui attribue effectivement ADMIN.

La protection des changements de rôle sur une fiche existante ne protège pas ce chemin de création. La policy d’invitation vérifie le droit d’administrer le centre, qui inclut le gestionnaire, mais pas le rôle accordé. Le formulaire d’invitation propose également tous les rôles.

Preuves : [policy](E:/GitHub/DispoSp/supabase/migrations/0004_agent_administration.sql:95), [rattachement](E:/GitHub/DispoSp/supabase/migrations/20260919120000_grades_fonctions_roles.sql:111), [écriture serveur](E:/GitHub/DispoSp/src/lib/commands.server.ts:510). Résultat du diagnostic : rôle final ADMIN.

**Correction attendue :** imposer en base les rôles qu’un gestionnaire peut attribuer à une invitation, à l’insertion comme à la modification. Adapter ensuite le formulaire. Ajouter le test de non-escalade au parcours invitation → confirmation.

### A2 — P1 : l’arrivée d’un nouvel agent est interrompue dans l’application

L’écran de connexion n’offre que mot de passe, SSO et récupération. Aucune utilisation de signUp, createUser ou inviteUserByEmail n’existe dans src. Pourtant, l’invitation ne fait qu’écrire une ligne métier et le formulaire demande encore à l’agent de créer son compte sur le site. Le pied de page affirme, lui, que les comptes sont créés par l’administrateur.

Preuves : [modes de connexion](E:/GitHub/DispoSp/src/components/auth.tsx:51), [invitation](E:/GitHub/DispoSp/src/components/management.tsx:520), [commande](E:/GitHub/DispoSp/src/lib/commands.server.ts:510).

**Conséquence :** pour un nouvel agent utilisant un mot de passe, sans compte Auth précréé ni SSO configuré, enregistrer une invitation ne permet pas de rejoindre le centre depuis l’application. Un provisionnement manuel dans Supabase peut contourner le problème, mais ce n’est pas le parcours décrit dans RECETTE.md.

**Correction attendue :** choisir un parcours unique et complet — inscription réservée aux invités, ou création/invitation Auth administrée côté serveur — puis aligner l’interface, les déclencheurs et la recette.

### A3 — P1 : les lectures peuvent produire des tableaux incomplets ou trompeurs

Deux problèmes se cumulent dans [loadState](E:/GitHub/DispoSp/src/lib/data.server.ts:7).

**Absence de pagination.** Les disponibilités de toutes les campagnes, les créneaux et les révisions d’affectations sont chargés sans pagination. Le plafond standard de réponse Supabase est de 1 000 lignes, configurable ; sa valeur réelle sur ce projet n’a pas été vérifiée. À cette valeur, **33 agents × 31 jours = 1 023 disponibilités** dépassent déjà le plafond. Les campagnes historiques et les révisions augmentent encore le volume. Une matrice virtualisée à 300 agents ne résout pas la limitation de lecture en amont. [Documentation Supabase sur le plafond de réponse](https://supabase.com/docs/reference/python/select).

**Erreurs ignorées.** Le code prend data ou un tableau vide sans examiner error. Un diagnostic a injecté une erreur sur availability_entries : loadState a renvoyé un état contenant zéro disponibilité sans signaler l’échec. Une panne de lecture peut ainsi ressembler à une absence de réponses ; les exports consomment le même état.

**Correction attendue :** distinguer explicitement erreur, absence et chargement partiel ; paginer avec un ordre stable ; charger la campagne utile ; agréger les statistiques en base ou via des requêtes dédiées. Tester plusieurs milliers de lignes et une défaillance d’une des lectures.

### A4 — P1 : les taux de réponse utilisent le centre entier au lieu des participants

La création de campagne inscrit les membres actifs de l’équipe ciblée. En revanche, le modèle d’écran ne conserve ni le périmètre des participants non validés ni l’équipe de la campagne. Le dashboard divise les réponses validées par tous les agents actifs chargés dans le centre.

**Reproduit :** une campagne avec un seul participant, ayant validé, et un second agent d’une autre équipe produit **50 %** au lieu de **100 %** avec le calcul actuel. Le second agent apparaît comme non-répondant alors qu’il n’est pas invité.

Preuves : [perte du périmètre](E:/GitHub/DispoSp/src/lib/data-mapping.ts:284), [participants réduits aux validations](E:/GitHub/DispoSp/src/lib/data-mapping.ts:312), [dénominateur du dashboard](E:/GitHub/DispoSp/src/components/dashboard.tsx:38).

La synthèse, les compteurs de campagnes et les statistiques reposent aussi sur state.agents. Les agents voient par ailleurs les campagnes du centre via RLS, même lorsqu’ils n’en sont pas participants ; ils peuvent arriver sur un calendrier où l’écriture est refusée.

**Correction attendue :** porter les participants et l’équipe dans le modèle de campagne, calculer les indicateurs sur cette population et choisir explicitement les campagnes proposées à chaque agent. Ne pas confondre ce problème avec le choix documenté de calculer certaines statistiques sur l’effectif actuel.

### A5 — P1 : la publication accepte encore des agents qui ne doivent plus être retenus

**Deux scénarios reproduits :**

- Après acceptation d’un désistement, la même affectation est republiée avec succès, en révision 2.
- Après désactivation de cet agent, la publication réussit encore, en révision 3, tant que les anciennes disponibilités validées sont présentes.

[La fonction de publication](E:/GitHub/DispoSp/supabase/migrations/0002_planning.sql:278) vérifie les réponses et les qualifications, mais ne tient compte ni du statut actif du membre ni des désistements acceptés. [La couverture](E:/GitHub/DispoSp/src/lib/domain.ts:305) n’intègre pas non plus les désistements. La notification d’acceptation dit pourtant que l’agent n’est plus attendu.

Conserver la version publiée jusqu’à remplacement est une décision compréhensible et documentée. Elle doit s’accompagner d’une alerte opérationnelle et ne doit pas permettre de confirmer de nouveau le même agent comme si rien n’avait changé.

**Correction attendue :** définir l’éligibilité après désistement, la vérifier côté base à chaque publication et la refléter dans les viviers et indicateurs. Contrôler le statut actif, y compris lors d’appels directs à l’API. Prévoir le cas d’une nouvelle affectation ultérieure pour éviter qu’un ancien désistement interdise définitivement une garde.

### A6 — P1 : l’édition des besoins peut supprimer des qualifications malgré un refus

[writeOneRequirement](E:/GitHub/DispoSp/src/lib/commands.server.ts:279) modifie l’effectif, supprime les minima existants puis insère les nouveaux dans des requêtes séparées.

**Reproduit en suivant ces écritures :** un minimum SAP de 1 existe ; l’effectif est passé à 2 ; les anciens minima sont supprimés ; l’insertion d’un minimum de 3 est refusée. Résultat : **plus aucun minimum**, alors que l’opération signale une erreur. Une panne réseau ou un refus d’écriture lors de la dernière étape a le même problème de transaction.

Le risque dépasse un besoin en lot partiellement appliqué : un seul créneau peut perdre ses exigences de qualification. En outre, [le provider](E:/GitHub/DispoSp/src/components/provider.tsx:58) ne recharge pas les données après un échec ; la modification partielle peut rester invisible à l’écran.

**Correction attendue :** rendre atomique au moins l’écriture complète d’un besoin, puis choisir la sémantique du lot : tout ou rien, ou résultat détaillé par créneau. Une fonction SQL transactionnelle peut parfaitement conserver les contrôles RLS et les déclencheurs ; regrouper les écritures ne les supprime pas.

### A7 — P2 : la CI sans configuration Supabase ne peut pas assurer les tests publics annoncés

Le workflow ne fournit pas de coordonnées Supabase. Or [le middleware](E:/GitHub/DispoSp/src/lib/supabase/middleware.ts:9) appelle credentials avant de traiter les chemins publics, notamment le manifeste et la page hors ligne.

**Reproduit sans variables :** une demande sur /manifest.webmanifest échoue avec « Le projet Supabase n’est pas configuré ». Les six tests navigateur réussis localement ont utilisé le build local disposant du fichier .env ; ils ne prouvent donc pas que le workflow GitHub passe dans son environnement déclaré.

**Correction attendue :** définir un environnement de test explicite et isolé, ou un traitement contrôlé des routes publiques sans dépendance Auth. Ajouter ensuite de vrais parcours connectés avec un administrateur, un gestionnaire et un agent.

## 3. Autres points de fiabilité et de maintenance

| Sujet                            | Constat                                                                                                                                                                                           | Suite proposée                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| File d’emails                    | Lot de 50 après certaines commandes, sans traitement autonome ni réservation des messages. Un échec de marquage ou deux envois concurrents peuvent produire des doublons.                         | Worker planifié, reprise, idempotence et suivi d’envoi.                                              |
| Emails de désistement            | Les commandes de demande et décision ne déclenchent pas dispatch ; leurs notifications peuvent attendre une autre commande. Le libellé email par défaut propose de renseigner les disponibilités. | Décider des canaux attendus, déclencher l’envoi approprié et fournir des liens adaptés.              |
| Liens vers les gardes            | Depuis une demande, le lien contient date et créneau, mais pas campagne. Planning conserve la campagne sélectionnée et rabat une date hors mois sur son premier jour.                             | Inclure l’identifiant de campagne dans les liens et synchroniser le contexte.                        |
| Sélection de campagne            | La sélection initiale prend la première campagne, alors que la requête trie les débuts par ordre croissant. Deux campagnes du même mois ont le même libellé dans le sélecteur.                    | Choix par pertinence temporelle et libellé mois + équipe ou nom.                                     |
| Historique                       | Les filtres et le CSV portent sur les 200 dernières actions chargées. L’avertissement d’interface est utile, mais ce n’est pas une recherche exhaustive par période.                              | Pagination et filtrage serveur ; export complet de la période demandée.                              |
| Concurrence                      | Pas de contrôle de version transmis lors des modifications du brouillon ; la publication ne verrouille pas explicitement le créneau avant de calculer la révision suivante.                       | Tester deux sessions simultanées, sérialiser la publication et définir les conflits de modification. |
| Premier centre                   | Sans campagne, le layout bloque tout l’espace et renvoie au script de provisionnement. Le texte annonce encore une création en interface à venir.                                                 | Autoriser l’amorçage de la première campagne pour l’administrateur et corriger le texte.             |
| Erreur réseau côté interface     | run ne traite pas les rejets réseau de submitCommand ; plusieurs actions restent cliquables pendant l’écriture.                                                                                   | État en cours, gestion des exceptions et protection contre les doubles clics.                        |
| Multi-organisation               | Le schéma peut porter plusieurs appartenances, mais readSession utilise maybeSingle sans choix d’organisation.                                                                                    | Décider si un compte peut appartenir à plusieurs centres et aligner lecture/UX.                      |
| Actualisation entre utilisateurs | Pas d’abonnement Realtime identifié ; le rechargement suit surtout les actions de l’utilisateur courant.                                                                                          | Définir un rafraîchissement ou un abonnement ciblé pour les usages simultanés.                       |
| Dette technique                  | Convention middleware dépréciée, avertissement React Compiler/TanStack et commentaires encore relatifs à quatre rôles ou à la démonstration.                                                      | Nettoyage ciblé après les corrections de droits et de données.                                       |

Ces points n’ont pas tous fait l’objet d’une reproduction en environnement hébergé. Ils sont identifiés dans le code et doivent être validés selon leur scénario d’usage.

## 4. Couverture fonctionnelle réelle

| Domaine           | Ce qui est présent                                                                                | Réserve principale                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Connexion         | Mot de passe, récupération, formulaire SSO                                                        | Création de compte interrompue ; SSO et récupération multi-appareil à vérifier avec la configuration réelle |
| Agents et équipes | Fiches, grade/fonction, qualifications, invitations, activation, trois rôles                      | Escalade par invitation ; dépendance au provisionnement initial                                             |
| Disponibilités    | Cinq états, commentaires, saisie multiple, modèles enregistrés/appliqués atomiquement             | Lecture complète, périmètre de campagne et tests navigateur connectés à sécuriser                           |
| Campagnes         | Création atomique, clôture, horaires figés par campagne                                           | Équipe de création imposée par la session ; ouverture immédiate, sans date future d’ouverture proposée      |
| Couverture        | Potentielle/planifiée distinctes, besoins inconnus identifiés, niveaux de couleur, qualifications | Désistements et participants à intégrer correctement                                                        |
| Planning          | Affectation manuelle, publications versionnées, planning personnel, équité Jour/Nuit/24 h         | Inactifs, désistements et concurrence                                                                       |
| Besoins           | Édition par garde et application à plusieurs jours/créneaux                                       | Risque de suppression partielle des minima                                                                  |
| Statistiques      | Campagnes, jours de semaine, agents                                                               | Dénominateur de population et exhaustivité des lectures                                                     |
| Désistements      | Demande, retrait, décision, notifications internes et audit                                       | Acceptation non prise en compte à la republication ; lien vers la bonne campagne                            |
| Exports           | CSV, ICS, Excel serveur, audit CSV, impression                                                    | Dépendent de données complètes ; historique limité ; recette PDF connectée à réaliser                       |
| PWA               | Manifeste, icônes, service worker, page hors ligne sans cache métier                              | Installation réelle Android/iOS et tests authentifiés non réalisés ici                                      |
| Exploitation      | Recette écrite, CI, migrations testées                                                            | Recette non renseignée, envois, sauvegarde/restauration et charge à démontrer                               |

La séparation disponibilité/affectation, la validation explicite, le rattachement de la nuit à sa date de début et la couverture Jour + Nuit par une disponibilité 24 h sont conservés. La souplesse multi-équipe existe en base, mais le périmètre de campagne n’est pas correctement porté jusqu’à tous les indicateurs.

## 5. Maquettes, ergonomie et design

Les huit maquettes ont été examinées : calendrier mobile, connexion, accueil agent, saisie rapide, planning personnel, dashboard, matrice et construction du planning.

Le code reprend leur structure : accueil agent spécifique, progression de saisie, accès rapides, couleurs des disponibilités, navigation basse sur mobile, barre latérale pour la gestion, tableaux de couverture et calendrier personnel. Le logo a évolué ; ce changement n’est pas un écart fonctionnel. La connexion mobile actuelle est lisible, avec des champs identifiés, affichage du mot de passe et récupération accessible.

Le rendu de connexion a été inspecté réellement. Les écrans métier sont évalués ici par leurs composants et styles, sans session connectée ; je ne peux donc pas certifier leur fidélité visuelle, leur ergonomie complète ni la pagination d’un PDF imprimé. Les tests responsive actuels ne mesurent que /connexion et /hors-ligne.

Les correctifs précédents de la matrice imprimée sont bien présents : suspension de la virtualisation avant impression, rendu de toutes les lignes filtrées et styles d’impression. Ce point ne doit plus être décrit comme absent, mais doit être vérifié avec une campagne réelle de grande taille.

Priorités UX : rendre l’entrée d’un nouvel agent possible ; distinguer clairement campagne, équipe et mois ; afficher un désistement accepté comme un remplacement à traiter dans les vues de couverture ; garder les états affichés cohérents lorsqu’une écriture échoue.

## 6. Ce que la documentation doit rectifier

- Ne plus présenter l’inscription comme disponible dans l’application tant que le parcours n’est pas rétabli ou remplacé.
- Nuancer « seul un administrateur change un rôle » tant que l’invitation peut accorder ADMIN.
- Ne pas assimiler virtualisation et capacité à charger plusieurs centaines d’agents : pagination et historique sont des problèmes distincts.
- Ne pas considérer les besoins en lot comme simplement partiels sans documenter la perte possible des minima d’un créneau.
- Supprimer la référence aux « trois variables du mode connecté » dans le plan : le mode a disparu ; les coordonnées Supabase sont deux variables, les emails en exigent trois autres.
- Distinguer les tests PostgreSQL, les tests publics de navigateur et une recette connectée. Le journal de RECETTE.md est vide et ne prouve pas qu’un essai a eu lieu.
- Décrire précisément la portée limitée du filtre/export d’historique et des statistiques historiques sur effectif actuel.

Les documents existants n’ont pas été modifiés par cet audit ; ce rapport rassemble les écarts à arbitrer et corriger.

## 7. Ordre de travail recommandé

1. **Fermer l’escalade par invitation** et tester les rôles à chaque étape du rattachement.
2. **Rétablir l’arrivée d’un agent** et vérifier le parcours réel invitation → compte → confirmation → accès.
3. **Fiabiliser la lecture** : erreurs explicites, pagination, participants par campagne, exports cohérents.
4. **Renforcer la publication** : membres actifs, désistements acceptés, conflits et révisions.
5. **Rendre les besoins atomiques**, puis traiter les erreurs partielles des autres écritures composées.
6. **Restaurer les parcours E2E connectés et la CI sans dépendance implicite au .env local.**
7. **Réaliser la recette du centre pilote**, puis les contrôles d’envoi, de restauration, de concurrence, d’impression et d’installation mobile.

Les ajouts fonctionnels suivants peuvent attendre cette stabilisation. La prochaine tranche utile est un correctif de droits et de cohérence des données, accompagné de tests reproduisant les défauts identifiés.
