# DispoSP — Spécifications des évolutions opérationnelles

Date de création : 16 octobre 2026. Révision : 17 octobre 2026.

Statut : document de cadrage pour le développement. Les fonctionnalités décrites ci-dessous sont des objectifs à réaliser, pas une déclaration de fonctionnalités déjà livrées ou activées sur le site.

## 1. Objectif et périmètre

Réduire les appels nécessaires aux remplacements, simplifier la publication du planning, rappeler les gardes aux agents et fournir un bilan fiable au centre. Le gestionnaire conserve la décision d'affectation et de publication.

Quatre fonctionnalités sont concernées :

1. Appels à remplacement ou à renfort, avec proposition de l'agent et confirmation du gestionnaire.
2. Agenda personnel abonné et rappels automatiques, soutenus par un traitement planifié fiable.
3. Publication mensuelle des créneaux prêts, avec un avis récapitulatif par agent concerné.
4. Bilan mensuel historique, consultable et transmissible après validation explicite.

L'ordre de réalisation est : **0 — recette isolée et contrat d'historisation ; A — traitements planifiés et premières photographies ; B — publication mensuelle ; C — remplacements ; D — agenda abonné ; E — bilan mensuel**. La collecte historique commence dans A, y compris pour les publications unitaires existantes ; elle n'attend pas l'écran du bilan.

Le succès devra être évalué en recette puis en utilisation : diminution des actions nécessaires à la publication, délai de remplacement, proportion d'appels résolus et régularité des réponses. Aucun gain chiffré n'est présumé dans ce document.

## 2. Décisions retenues et réglages proposés

### Décisions fonctionnelles retenues

- L'agent clique sur **« Je me propose »**. Cela ne l'affecte pas automatiquement à une garde.
- Le gestionnaire peut **« Accepter et chercher un remplaçant »** lors d'un désistement. L'acceptation simple reste possible.
- Un manque d'effectif peut déclencher **« Chercher du renfort »**, sur action explicite du gestionnaire. Une modification du brouillon ne déclenche pas à elle seule un appel collectif.
- La publication mensuelle publie les créneaux prêts et présente clairement ceux qui sont bloqués. Elle ne doit pas contourner les règles actuelles d'éligibilité à la publication.
- Une publication mensuelle produit un avis récapitulatif par agent dont les affectations publiées changent, y compris les agents retirés. Un agent sans changement ne reçoit pas d'avis.
- Un abonnement à l'agenda et un rappel envoyé par DispoSP sont deux services distincts.
- Le bilan utilise des données historiques : un départ du centre ou un changement de qualification ne réécrit pas les mois passés.
- Le bilan se prépare et se prévisualise avant tout envoi explicite.
- **Décision du 20 octobre — la clôture qui fait foi est la date de clôture de la campagne** (`closes_at`). Elle est fixée à la création et irréversible : après elle, la base refuse toute saisie et toute validation. Le verrouillage (« Verrouiller la saisie ») reste une pause réversible, sans photographie.
- **Décision du 20 octobre — les emails donnent la date et les horaires** des gardes concernées (rappel, récapitulatif, appel à remplacement), jamais le nom d’un autre agent ni le motif d’un désistement. Le push reste discret sur l’écran verrouillé.

### Arbitrages recommandés après relecture du 17 octobre

Les constats techniques ci-dessous sont vérifiés dans le dépôt. Les choix nouveaux de cette révision sont des **recommandations de cadrage**, pas des décisions déjà approuvées par le responsable du centre. En particulier, faire valider la déclaration exceptionnelle de disponibilité et la règle de repos avant d'activer le lot C.

| Point                       | Choix recommandé pour la V1                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disponibilité après clôture | « Je me propose » enregistre une déclaration explicite de disponibilité exceptionnelle pour ce créneau et cet appel, sans rouvrir ni revalider la campagne entière. Le gestionnaire confirme ensuite l'affectation.                                                                      |
| Affectations incompatibles  | Bloquer un chevauchement horaire réel avec une autre affectation publiée encore effective, ainsi qu'un doublon sur le même créneau. Signaler les brouillons concurrents. Ne pas inventer de durée minimale de repos ; faire préciser la règle opérationnelle du centre avant activation. |
| Recette                     | Un second projet Supabase **et** un déploiement HTTPS de recette relié uniquement à cette base. Une prévisualisation reliée à la production ne constitue pas une recette isolée.                                                                                                         |
| Notifications               | Ne pas créer de préférences générales dans cette V1. Garder les emails pour les événements concernés et le push uniquement sur les appareils activés. Les rappels sont activés au niveau du centre ; aucun réglage individuel de rappel n'est présumé existant.                          |
| Bilan                       | Photographies transactionnelles à chaque publication et à chaque clôture, puis agrégats historiques indépendants des comptes vivants. Adapter suppression et purge dès l'introduction de ces données.                                                                                    |

### Valeurs de départ

Ces réglages sont des valeurs de départ à confirmer au moment de leur mise en œuvre. Ils ne constituent pas des règles métier déjà validées.

| Sujet                    | Proposition                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Planification technique  | Supabase Cron et réutilisation des files d'envoi existantes                                     |
| Fréquence du traitement  | Toutes les 5 minutes, avec un travail borné par passage                                         |
| Rappel de garde          | La veille à 18 h, dans le fuseau du centre, heure configurable                                  |
| Relance de campagne      | 48 h puis 24 h avant clôture, uniquement pour les réponses non validées                         |
| Publication mensuelle V1 | Une campagne sélectionnée, donc un mois et une équipe ; pas toutes les équipes en une opération |
| Période de l'agenda      | 3 mois passés et 12 mois à venir, bornes ajustables                                             |
| Bilan                    | Un centre et un mois, avec ventilation par équipe                                               |
| Formats du bilan V1      | Page imprimable en PDF et export CSV ; pièce jointe PDF automatisée hors du premier périmètre   |

## 3. Règles existantes à préserver

- Les créneaux par défaut sont Jour **8 h–20 h** et Nuit **20 h–8 h**. Les horaires configurables de la campagne font foi : ne pas coder 8 h en dur dans les rappels ou l'agenda.
- Une nuit est rattachée à la date de son commencement. La nuit du 12 se termine le 13.
- Une disponibilité 24 h couvre potentiellement les besoins Jour et Nuit ; elle ne vaut pas double affectation automatique.
- Aujourd'hui, seules les disponibilités explicitement validées sont utilisables. Une modification peut invalider la validation de la campagne selon les règles existantes. Le lot C introduit une seconde preuve strictement limitée : la déclaration exceptionnelle décrite au §7. Elle exige une migration et l'adaptation commune des contrôles ; elle n'existe pas encore.
- **Couverture potentielle** : agents disponibles et éligibles. **Couverture planifiée** : affectations du brouillon. **Couverture publiée** : affectations effectivement publiées. Toujours nommer la mesure affichée.
- Les rôles GESTIONNAIRE et ADMIN ne prennent pas de gardes dans le modèle actuel. Les exclure des candidats au remplacement, des réponses attendues aux campagnes et des rappels personnels de garde.
- Les qualifications doivent respecter les correspondances du domaine actuel. Ne pas inventer d'équivalence entre des valeurs telles que `COD SSR`, `PL`, `COD2` ou `COD6` (les conduites, `src/lib/domain.ts`), ni avec « Conducteur PL », qualification distincte du catalogue.
- Les droits par centre et les contrôles de publication doivent être vérifiés côté serveur et en base. Un bouton masqué n'est pas une protection.
- Les notifications push actuelles restent discrètes sur l'écran verrouillé. La date et les détails de garde sont accessibles après ouverture et authentification ; un éventuel affichage détaillé sur écran verrouillé doit faire l'objet d'un choix explicite.
- Les écrans doivent rester utilisables sur téléphone, avec états de chargement, erreurs compréhensibles et protection contre les doubles actions.

## 4. Points d'intégration dans le dépôt

Repères relevés sur le dépôt au 16 octobre 2026, à revérifier avant chaque lot. Les chemins ci-dessous sont relatifs à la racine du dépôt.

| Domaine                          | Fichiers principaux                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Modèle et règles                 | `src/lib/domain.ts`                                                                           |
| Commandes et actions             | `src/lib/commands.server.ts`, `src/app/actions.ts`                                            |
| Chargement des données           | `src/lib/data.server.ts`, `src/lib/data-mapping.ts`                                           |
| Notifications email et push      | `src/lib/mailer.server.ts`, `src/lib/push.server.ts`, `src/lib/email.ts`, `src/lib/push.ts`   |
| Réception push                   | `public/sw.js`                                                                                |
| Déclenchement push existant      | `src/app/api/push/dispatch/route.ts`, `src/lib/push-auth.ts`                                  |
| Protection des routes            | `src/lib/supabase/config.ts`, `src/lib/supabase/middleware.ts`, `src/proxy.ts`                |
| Export agenda actuel             | `src/lib/exports.ts`, `src/components/my-planning.tsx`                                        |
| Planning et désistements         | `src/components/planning.tsx`, `src/components/withdrawals.tsx`                               |
| Tableau de bord et notifications | `src/components/dashboard.tsx`, `src/components/home.tsx`, `src/components/notifications.tsx` |
| Statistiques                     | `src/components/statistics.tsx`                                                               |
| Schéma et tests de base          | `supabase/migrations/`, `tests/fixtures/schema.ts`, `supabase/provisioning/`                  |

L'envoi actuel est notamment déclenché après des actions utilisateur. La route de traitement existante concerne le push ; elle ne suffit pas à orchestrer les emails, les rappels et les relances.

L'agenda actuel est un fichier exporté. L'abonnement nécessite un flux accessible dans la durée et une authentification adaptée aux clients d'agenda.

La publication unitaire ne doit pas simplement être appelée en boucle pour réaliser la publication mensuelle : cela conserverait les avis par créneau et ne fournirait pas la garantie transactionnelle attendue.

Les statistiques actuelles fondées sur l'effectif courant ne suffisent pas à construire un historique stable.

Constats vérifiés lors de la révision : `private.publish_schedule_shift` dans `20260927090000_correctifs_bilan.sql` exige une saisie correspondant au créneau et un participant validé. `campaignAgents` dans `src/lib/domain.ts` filtre les agents actuellement chargés et leur rôle actuel ; ce filtre, dont C6, ne doit pas servir au calcul historique. Les versions d'affectation publiées et le journal de publication fournissent déjà une partie de la chronologie, mais pas la photographie complète des besoins et qualifications. Les scripts `supabase/provisioning/retirer-un-compte.sql` et `supabase/provisioning/purger-les-donnees-anciennes.sql` suppriment aujourd'hui des sources de ces calculs.

### Préalable 0 — Recette isolée et contrat d'historisation

Le site hébergé sert actuellement à la fois de recette et de production, selon l'état communiqué par le porteur du projet. Ne pas lancer les essais automatiques de ces lots sur cette base.

Préparer avant la recette intégrée :

1. Un second projet Supabase, avec les migrations nécessaires et des données fictives : au moins deux centres pour les tests de cloisonnement, plusieurs campagnes, agents et qualifications.
2. Un déploiement HTTPS de recette, par exemple une prévisualisation Vercel avec une adresse stable, exclusivement relié à cette base. Le déclencheur distant doit atteindre sa route ; Google Agenda doit pouvoir lire le flux depuis ses serveurs sans session navigateur ni écran de protection du déploiement. N'exempter que les routes nécessaires, protégées par leurs propres secrets.
3. Des variables propres à cet environnement : URL de l'application, URL et clés de base, secret du traitement, clés push et configuration d'envoi. Aucun abonnement push, jeton d'agenda ou jeu de données personnel de production n'est recopié.
4. Des adresses et appareils de test explicitement autorisés, avec blocage des autres destinataires pour les essais d'envoi. Les tâches planifiées restent désactivées jusqu'à vérification des cibles.
5. Un contrat de photographies défini avant les migrations des lots : événements, champs conservés, unités, suppression/purge, traitement des clôtures automatiques et des changements de besoin.

Les tests locaux peuvent commencer avant ce déploiement. En revanche, les lots A et D ne peuvent pas être déclarés validés de bout en bout sans cette recette accessible à distance. La création des services et leur éventuel coût constituent un travail séparé ; ce document ne les provisionne pas.

Acceptation du préalable : prouver que les données écrites en recette n'apparaissent pas en production ; vérifier les routes depuis l'extérieur avec leur authentification propre, le refus des accès invalides et le blocage des destinataires hors recette.

## 5. Lot A — Traitements planifiés et rappels

### État au 20 octobre 2026

**Développé (A1) :** traitement planifié, rappels de garde, relances avant clôture, reprises d'envoi, réglage et suivi dans Paramètres.

- Migration `20261020090000_traitements_planifies.sql`, **non appliquée**.
- Route `POST /api/traitements`.
- Scripts `supabase/provisioning/activer-les-traitements-planifies.sql` et `desactiver-les-traitements-planifies.sql`.
- Le README, section « Rappels automatiques et traitements planifiés », décrit le fonctionnement et la mise en service.

Les critères d'acceptation ci-dessous sont vérifiés par les tests PostgreSQL (`tests/database.test.ts`) et de route (`tests/traitements-route.test.ts`), puis sur une pile Supabase locale où Supabase Cron, `pg_net` et Vault appellent l'application :

| Critère                                | Preuve                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envoi échoué repris sans action        | La livraison planifiée vide les files toutes les cinq minutes, avec leurs reprises existantes                                                                                                                          |
| Pas d'événement en double              | Clé unique `notifications.event_key`, insertion `on conflict do nothing` ; génération sous verrou consultatif                                                                                                          |
| Agent retiré ou désactivé              | Recontrôle dans les deux réservations d'envoi, donc sur tous les chemins de vidage — y compris celui qui suit la commande d'acceptation. Contre-épreuve : sans ce recontrôle, le rappel de l'agent désisté est réservé |
| Europe/Paris, UTC, changements d'heure | Veille calculée sur la date locale ; tests aux 25 octobre 2026 et 28 mars 2027 ; suites jouées en Europe/Paris et en UTC                                                                                               |
| Appel sans authentification refusé     | 401 sans secret, avec un secret faux ou trop court ; vérifié aussi par `pg_net` avec un secret faux dans Vault                                                                                                         |
| Panne d'email sans effet sur le métier | La route traite push et emails séparément, inscrit l'échec au journal, et la file attend le passage suivant                                                                                                            |

Les horaires d'une campagne ne changent plus après sa création : le texte d'un rappel en attente ne peut donc devenir faux que par l'affectation, ce que le recontrôle couvre.

**Reste (A2) :** photographies des publications unitaires et des clôtures, et adaptation de la suppression et de la purge. Ces migrations attendent la validation du contrat de photographies (préalable 0, point 5). La validation de bout en bout du lot attend la recette isolée (préalable 0, points 1 à 4).

### Résultat attendu

Les rappels et reprises d'envoi fonctionnent même si personne n'ouvre l'application. Le traitement réutilise les mécanismes existants de file, d'idempotence et de reprise.

### Fonctionnement

1. Un déclencheur planifié appelle un traitement serveur protégé.
2. Le traitement crée les événements arrivés à échéance : rappels de garde et relances de campagne.
3. Il traite les envois en attente ou temporairement échoués, par lots bornés.
4. Il enregistre son résultat, les échecs et le travail restant. Un passage suivant reprend ce qui n'a pas été traité.

Séparer la génération des notifications et leur livraison. Un échec du fournisseur ne doit pas annuler une publication ou une confirmation métier réussie.

Prévoir une activation explicite, une désactivation simple et une visibilité de gestion sur le dernier passage réussi, les erreurs récentes et les envois en attente. Ne pas afficher de secrets ni de données personnelles inutiles dans ces diagnostics.

### Fiabilité et reprises

- Borner la durée, le nombre d'éléments et les appels fournisseurs de chaque passage.
- Empêcher deux traitements concurrents de prendre le même travail, avec les mécanismes de réservation et d'expiration adaptés.
- Une contrainte d'unicité en base protège chaque événement logique : une simple vérification préalable en code ne suffit pas.
- Reprendre les erreurs temporaires avec temporisation. Ne pas relancer indéfiniment une adresse invalide ou un abonnement définitivement périmé.
- Conserver une clé d'idempotence cohérente avec le contenu exact envoyé et le résultat connu du fournisseur. Respecter les règles de reprise existantes et les limites du fournisseur.
- Resend conserve ses clés d'idempotence pendant une durée limitée : ne pas promettre une livraison « exactement une fois » sans limite temporelle.
- Vérifier la pertinence au moment de créer la notification et avant de remettre l'envoi au fournisseur. Annuler les envois devenus obsolètes.
- Une notification déjà remise au fournisseur ne peut pas être rappelée. Une modification ultérieure doit pouvoir produire un avis correctif approprié.

### Rappel de garde

- Destinataire : agent actif, affecté à une garde publiée encore pertinente, sans retrait effectif de cette garde.
- Calculer « la veille » dans le fuseau du centre, à partir de l'heure réelle du créneau. Tester les changements d'heure ; soustraire arbitrairement 24 h ne suffit pas à définir une date locale.
- Présenter dans l'application un texte du type : « Vous êtes de garde demain de 8 h à 20 h ».
- Regrouper les créneaux contigus d'une même garde de 24 h pour éviter deux rappels redondants, sans fusionner des gardes distinctes.
- Réévaluer les rappels en attente si les horaires ou les affectations changent.
- Si la garde est publiée après l'heure prévue du rappel, l'avis de publication reste immédiat ; éviter un rattrapage automatique trompeur annonçant « demain » trop tard.
- Il n'existe pas de préférence générale de canal : conserver l'envoi email et limiter le push aux appareils activés pour le compte. Respecter la discrétion de l'écran verrouillé. L'envoi push ne prouve pas sa lecture.

### Relance avant clôture

- Campagne encore ouverte et non verrouillée ; destinataires actifs qui doivent répondre et dont la réponse n'est pas validée.
- Dédupliquer les relances manuelles et automatiques selon une règle commune de fréquence : la règle actuelle des 12 heures (`private.campaign_reminders`). La fonction de relance existante exige la session d’un gestionnaire ; le traitement planifié en utilise une variante serveur qui partage cette table.
- Ne pas envoyer une succession de relances anciennes après une interruption du traitement.
- Recontrôler la validation et la clôture avant l'envoi effectif.

### Sécurité des routes

Le traitement planifié utilise une identité technique ou un secret serveur. Il ne dépend pas d'un cookie de connexion au navigateur. Conserver les secrets côté serveur, par exemple dans Vault pour le déclenchement Supabase.

Le middleware protège actuellement les routes API. Ajouter uniquement l'exception précise nécessaire au traitement, avec sa propre authentification forte ; ne pas rendre publiques toutes les routes API.

### Critères d'acceptation

- Un envoi temporairement échoué est repris sans action utilisateur.
- Deux déclenchements concurrents ne créent pas deux événements identiques.
- Un agent retiré ou désactivé ne reçoit pas un rappel encore en attente pour cette garde.
- Les tests couvrent Europe/Paris, UTC et les transitions d'heure d'été et d'hiver.
- Un appel sans authentification technique valide est refusé.
- Une panne d'email laisse la publication métier réussie et permet une reprise contrôlée.

## 6. Lot B — Publier le mois

### Parcours gestionnaire

Dans le planning d'une campagne, proposer **« Publier le mois »**. Une prévisualisation distingue les créneaux prêts, les créneaux bloqués et ceux qui sont déjà publiés sans changement.

Exemple : **62 créneaux : 48 prêts à publier, 10 bloqués, 4 inchangés**. Pour chaque blocage, afficher la date, Jour/Nuit, le motif et un accès au créneau concerné.

Le bouton final indique exactement **« Publier les 48 créneaux prêts »**. Si aucun créneau n'est prêt, expliquer pourquoi. Les créneaux bloqués restent dans leur état précédent ; ne pas effacer une publication existante sous prétexte que le nouveau brouillon est incomplet.

### Garantie métier

- Réutiliser les contrôles de la publication unitaire : effectif, qualifications, preuve de disponibilité, éligibilité et droits. Après le lot C, la preuve accepte aussi une déclaration exceptionnelle autorisée ; aucune publication, unitaire ou mensuelle, ne doit contourner ses conditions.
- Publier uniquement les créneaux nouveaux ou modifiés qui passent ces contrôles.
- La sélection prête est publiée en une transaction, avec l'enregistrement des avis à produire. Un échec annule toute cette opération.
- Si les données pertinentes changent entre la prévisualisation et la confirmation, refuser cette confirmation et demander une actualisation. Ne pas publier silencieusement un lot différent.
- Gérer les verrous dans un ordre stable et protéger l'opération par un identifiant d'idempotence.
- Mutualiser les règles avec la publication unitaire pour éviter deux définitions divergentes d'un créneau publiable.

### Avis récapitulatif

Comparer les affectations publiées avant et après l'opération. Produire un seul événement de notification par agent concerné, avec la liste de ses ajouts, modifications et retraits.

Un agent dont toutes les gardes ont été retirées doit aussi recevoir un avis. Un agent sans changement ne reçoit rien. Les avis unitaires par créneau ne doivent pas être émis en plus du récapitulatif.

« Un seul avis » signifie un événement métier unique : il est visible dans l'application, mis en file pour l'email et distribué sur les appareils où le compte a activé le push. Aucune préférence individuelle d'email ou de rappel n'existe actuellement. Une telle option serait un périmètre supplémentaire, avec stockage, interface et contrôle avant envoi.

### Critères d'acceptation

- Un mois partiellement prêt publie la sélection annoncée et conserve les autres créneaux.
- Aucune insuffisance ne contourne les contrôles de publication existants.
- Une prévisualisation périmée ne provoque pas de publication partielle.
- Chaque agent concerné reçoit un seul récapitulatif, y compris en cas de retrait total.
- Un double clic ou une reprise réseau ne crée pas une seconde publication ni un second avis.
- Un agent ou un gestionnaire d'un autre centre ne peut pas déclencher l'opération.

## 7. Lot C — Remplacement et renfort

### Déclenchement

Deux entrées : **« Accepter et chercher un remplaçant »** depuis un désistement et **« Chercher du renfort »** depuis un créneau insuffisamment couvert.

Avant confirmation, afficher le créneau, le besoin restant, les qualifications manquantes et le nombre de destinataires éligibles. S'il n'existe aucun candidat, l'expliquer. L'acceptation simple du désistement reste possible.

L'ouverture d'un appel et son rattachement au désistement accepté doivent être cohérents en base. L'envoi des notifications intervient ensuite et peut être repris indépendamment.

### Éligibilité et élargissement de l'appel

- Agent actif prenant des gardes, dans le centre et le périmètre d'équipe autorisé.
- Premier cercle de sollicitation : disponibilité validée couvrant le créneau.
- Si nécessaire, le gestionnaire peut explicitement élargir l'appel aux agents du même périmètre dont la disponibilité a pu changer, y compris ceux initialement indisponibles ou sans réponse validée. Présenter séparément ces destinataires ; ils ne comptent pas comme disponibles avant leur déclaration. Pas d'élargissement automatique ni de relance des agents qui ont retiré leur proposition.
- Pas d'affectation publiée incompatible connue ni d'affectation déjà présente sur le créneau, selon la définition ci-dessous.
- Qualifications utiles au besoin restant, calculé à partir de l'équipe effectivement conservée.
- Ne pas exiger de chaque candidat qu'il possède à lui seul toutes les qualifications manquantes : plusieurs candidats peuvent se compléter.
- Ne pas solliciter automatiquement l'agent dont le désistement vient d'être accepté pour reprendre sa propre garde. Un retour volontaire éventuel doit relever d'un parcours explicite.
- Pas d'élargissement automatique aux autres équipes ou centres dans cette première version.

### Déclaration exceptionnelle après clôture

Recommandation : le bouton **« Je me propose »** est accompagné du texte **« Je confirme être disponible le [date], de [début] à [fin], pour cette garde. Mon affectation reste soumise à confirmation du gestionnaire. »** La déclaration est une action explicite de l'agent authentifié ; le gestionnaire ne peut pas la fabriquer à sa place.

Enregistrer dans une même transaction la proposition et sa preuve : agent, centre, campagne, créneau, appel, horaires acceptés, date de déclaration et version des conditions affichées. Cette preuve ne modifie pas la saisie initiale, ne rouvre pas la campagne et ne change pas son taux de réponse à la clôture. Une déclaration Jour ne couvre pas implicitement la Nuit.

Adapter en base le contrôle partagé d'éligibilité : **disponibilité ordinaire validée et correspondante OU déclaration exceptionnelle valide pour cette affectation**. Cette seconde branche exige une proposition sélectionnée par un gestionnaire autorisé dans le parcours de remplacement ; une déclaration pour un autre appel ou une proposition non retenue ne suffit pas à publier. Conserver les autres contrôles d'effectif, de qualification, d'activité et de désistement.

Un retrait de proposition avant publication révoque la déclaration et invalide sa sélection en brouillon. Une modification des horaires exige une nouvelle confirmation de l'agent. Après publication, conserver la preuve rattachée à l'affectation : la clôture de l'appel ne doit pas la rendre invalide lors d'une republication inchangée. Une suppression effective de cette affectation termine cette autorisation ; une future réaffectation exige une nouvelle déclaration. Après publication, un empêchement relève du désistement, pas d'un retrait silencieux de candidature.

### Définition des incompatibilités

- Calculer les intervalles réels `[début, fin[` avec date, horaires de campagne et fuseau. Deux créneaux se chevauchent si chacun commence avant la fin de l'autre. Deux créneaux qui se touchent ne se chevauchent pas.
- Bloquer le doublon sur la même garde et le chevauchement avec une autre affectation publiée effective de l'agent, dans toutes les campagnes connues du système. Exclure la version remplacée de la même garde et les affectations annulées ou dont le désistement a été accepté.
- Contrôler ces conflits à la candidature puis à la publication, sous une protection concurrente commune par agent. Le verrou du seul créneau ne suffit pas pour deux gardes différentes.
- Un brouillon concurrent déclenche un avertissement ; il n'est pas encore un engagement publié. Recontrôler lors de chaque publication, y compris hors remplacement.
- Signaler les enchaînements Jour/Nuit et Nuit/Jour. Une garde de 24 h reste possible selon le modèle existant. Aucune durée minimale de repos n'est déduite de ce document : faire préciser la règle du centre avant activation, puis la formaliser et la tester si elle doit être bloquante. Les engagements externes non enregistrés ne peuvent pas être contrôlés automatiquement.

### Parcours agent

Après ouverture de la notification et authentification, afficher la date, les horaires et le besoin, puis **« Je me propose »**.

La proposition est enregistrée avec un état **« En attente de confirmation du gestionnaire »**. Elle ne crée ni affectation publiée, ni événement dans l'agenda, ni rappel de garde. L'agent peut retirer sa proposition tant qu'elle n'a pas donné lieu à une publication, y compris si le gestionnaire l'a sélectionnée dans un brouillon encore incomplet.

Ne pas exposer le motif privé du désistement ni le nom de l'agent remplacé dans l'appel. Une visite de lien ou une requête GET ne doit jamais enregistrer une proposition.

### Parcours gestionnaire et concurrence

Afficher les candidats, leurs qualifications utiles, les informations de charge déjà autorisées et l'heure de proposition. Le premier clic d'un candidat ne lui réserve pas automatiquement la place.

À la confirmation, recontrôler les droits, le statut de l'appel, la disponibilité, les qualifications, les conflits et le besoin courant. Deux gestionnaires ne doivent pas pouvoir attribuer simultanément la même place.

Si la sélection permet une équipe complète et publiable, proposer **« Confirmer et publier »**, avec prévisualisation de toute l'équipe. L'affectation, la publication et la résolution de l'appel doivent rester cohérentes dans une transaction.

Si plusieurs places manquent encore, permettre de préparer le brouillon en indiquant clairement que la garde n'est pas encore confirmée à l'agent. Ne pas publier une garde insuffisante pour accélérer artificiellement le parcours.

Fermer l'appel lorsque le besoin est effectivement couvert par une publication. Informer les autres candidats que la recherche est terminée, sans divulguer d'informations inutiles. Annuler les sollicitations encore en attente.

Un appel peut également être annulé ou expirer au début du créneau. Ces issues ne comptent pas comme un remplacement réussi.

### Modèle de données proposé

Les noms exacts seront adaptés aux conventions du dépôt.

| Objet       | Informations principales                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Appel       | Centre, campagne, créneau, origine, besoin au déclenchement, auteur, ouverture, expiration, état, référence de version |
| Proposition | Appel, agent, date de proposition, retrait éventuel, décision, décideur et dates associées                             |
| Résolution  | Appel, date de résolution, version publiée qui couvre le besoin et agents confirmés                                    |

Protéger par contraintes l'unicité d'un appel actif par créneau et d'une proposition active par agent et appel. Conserver l'historique des transitions. Une nouvelle recherche après résolution constitue un nouvel épisode, sans écraser le délai du précédent.

### Critères d'acceptation

- Les candidats non éligibles sont refusés même par un appel direct au serveur.
- Un agent initialement indisponible peut, après clôture, déclarer sa disponibilité pour un appel élargi, puis être publié après confirmation du gestionnaire sans modifier la campagne ni sa validation historique.
- Une déclaration retirée, destinée à un autre créneau ou portant sur des horaires devenus différents ne permet aucune publication.
- La fermeture de l'appel ne casse pas une republication inchangée de l'agent retenu ; son retrait effectif interdit la réutilisation ultérieure de la preuve.
- Deux gardes aux codes différents mais aux horaires chevauchants sont bloquées ; une nuit traversant minuit et deux créneaux contigus sont testés séparément.
- Une proposition seule n'apparaît ni dans le planning publié ni dans l'agenda personnel.
- Deux candidats complémentaires peuvent couvrir un besoin que chacun ne couvre pas seul.
- Un changement de disponibilité ou de qualification avant confirmation est détecté.
- Deux confirmations simultanées ne créent pas de surnombre ou de décision contradictoire.
- Un appel fermé reste consultable avec son état réel et n'accepte plus de nouvelle proposition.
- La clôture annule les envois devenus inutiles et conserve les données nécessaires au bilan.

## 8. Lot D — Agenda personnel abonné

### Parcours

Dans **Mon planning**, ajouter **« M'abonner à mon agenda »**, avec une adresse privée et des instructions pour Apple Calendar, Google Agenda et les clients compatibles. Conserver l'export ponctuel actuel.

Expliquer que les mises à jour dépendent de la fréquence de synchronisation du logiciel d'agenda. L'abonnement ne garantit pas un affichage immédiat d'une modification urgente ; les notifications de DispoSP restent distinctes.

Permettre de révoquer le lien puis d'en générer un nouveau. Prévenir que l'ancien abonnement devra être remplacé dans le logiciel d'agenda.

### Contenu du flux

- Uniquement les gardes publiées de l'agent, sur l'ensemble de ses campagnes dans le périmètre autorisé.
- Exclure les brouillons, propositions et gardes dont l'agent a été effectivement relevé.
- Respecter les horaires de campagne, les nuits et le fuseau du centre.
- Conserver un identifiant d'événement stable lors des modifications ; gérer les dates de mise à jour et la séquence des révisions.
- Définir et tester le traitement des suppressions : retrait du flux et, si nécessaire pour les clients ciblés, événements annulés conservés temporairement.
- Une alarme ICS éventuellement proposée ne remplace pas le rappel serveur de DispoSP.

### Sécurité

L'adresse d'abonnement constitue un accès privé : toute personne qui la possède peut potentiellement consulter son contenu. Utiliser un jeton opaque, aléatoire et révocable, stocké sous forme de condensat côté serveur. Ne pas placer de jeton de session ou de clé de service dans l'URL.

Le flux doit fonctionner sans cookie de navigateur et disposer de sa propre vérification. Prévoir l'exception précise au middleware, comme pour le traitement planifié.

Vérifier à chaque lecture que l'accès reste autorisé. La désactivation du compte, la perte de son éligibilité ou la révocation du lien coupe l'accès. Ne pas journaliser le lien secret ni exposer le flux dans un cache public.

### Critères d'acceptation

- Un lien valide fonctionne dans un client d'agenda sans session navigateur ; un lien invalide ou révoqué ne révèle aucune garde.
- Aucun paramètre ne permet de choisir arbitrairement l'identité d'un autre agent.
- Ajout, changement d'horaire et retrait se répercutent sans doublon après synchronisation.
- Les brouillons et propositions restent absents du flux.
- La recette comprend de vrais abonnements Apple Calendar et Google Agenda, avec observation des délais et du retrait d'un événement. Un test HTTP seul ne valide pas cette compatibilité.

## 9. Lot E — Bilan mensuel historique

### Parcours gestionnaire

Dans Statistiques, proposer **« Préparer le bilan mensuel »**. Choisir le mois et le périmètre autorisé, puis afficher le bilan, les définitions des indicateurs, la date de génération et les éventuelles données manquantes.

Permettre l'impression en PDF et l'export CSV. Un envoi nécessite une prévisualisation, une sélection explicite de destinataires autorisés du centre et une confirmation. Ne pas ajouter d'envoi récurrent ni de destinataires externes arbitraires dans cette première version.

### Définition des indicateurs

| Indicateur                   | Définition                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taux de réponse              | Participations validées à la clôture / participations attendues à la clôture. Unité : couple agent–campagne, pour ne pas confondre plusieurs campagnes avec des agents uniques. |
| Couverture publiée           | Créneaux avec besoins définis dont la dernière version publiée avant le début satisfait effectif et qualifications / créneaux avec besoins définis.                             |
| Créneaux incomplets          | Créneaux avec besoins définis sans publication suffisante au début du créneau.                                                                                                  |
| Besoins non renseignés       | Nombre distinct, présenté à part ; ces créneaux ne sont pas considérés couverts et ne sont pas intégrés silencieusement au dénominateur précédent.                              |
| Appels résolus               | Parmi les appels ouverts pendant le mois, ceux résolus par une publication couvrant le besoin, rapportés au nombre d'appels ouverts. Préciser la date d'observation.            |
| Délai médian de remplacement | Médiane entre ouverture de l'appel et publication qui résout le besoin, sur les appels résolus de la cohorte. Afficher la taille de l'échantillon.                              |
| Appels non résolus           | Nombre et ancienneté, avec les annulations et expirations distinguées.                                                                                                          |

Le bilan mesure la préparation et les affectations publiées, pas la présence réelle en garde, qui n'est pas établie par ces données. Il ne présente pas la livraison d'un push comme une preuve de lecture.

Les créneaux relèvent du mois de leur date de début, y compris les nuits. Les agrégations par équipe doivent préciser leur unité ; ne pas compter deux fois une même entité métier lors d'une consolidation.

### Historisation indispensable

- À **chaque publication**, unitaire ou mensuelle, enregistrer dans la même transaction une photographie immuable : centre et équipe historiques, campagne, créneau et horaires, version publiée, date de publication, effectif requis, minima de qualifications, effectif affecté et qualifications pertinentes de chaque affecté à cet instant. Les référentiels doivent être versionnés ou leurs valeurs copiées : une jointure vers les qualifications actuelles ne constitue pas une photographie.
- À **chaque clôture**, figer la population attendue et ses validations à cet instant, en conservant le rôle et l'appartenance qui justifiaient son inclusion ainsi que les compteurs attendus et validés. Ne pas rappeler `campaignAgents` ni appliquer C6 sur l'effectif actuel pour reconstruire ce dénominateur.
- La photographie de clôture se prend à la date de clôture (décision du 20 octobre). Le traitement planifié la prend dès que cette date est passée ; si une mutation pertinente — rôle, activité, équipe, suppression d’une participation — survient avant qu’il soit passé, elle déclenche d’abord la photographie, dans la même transaction. Les mutations postérieures ne sont jamais comptées rétroactivement. Le verrouillage, réversible, ne produit pas de photographie ; la date de clôture n’étant pas modifiable, il n’existe pas de réouverture après elle.
- Versionner aussi les modifications des besoins entre publication et début du créneau, ainsi que les retraits effectifs d'affectation. À son début, figer le besoin applicable et la couverture effective publiée : un besoin relevé après publication ou un désistement accepté doit pouvoir faire apparaître une insuffisance sans attendre une republication. Les qualifications de référence pour ce bilan sont celles photographiées à la publication ; ne pas les relire depuis la fiche actuelle.
- Étendre les versions publiées et le journal existants plutôt que créer une chronologie concurrente. Ils servent de références, mais leur purge ne doit pas détruire les agrégats conservés.
- Installer ces captures dès le lot A, sur les fonctions existantes, puis les étendre dans B et C. Une photographie produite à la fin du mois à partir des seuls états courants ne suffit pas.
- Si un passage planifié est manqué, reconstituer l'état à l'instant prévu depuis l'historique, sans utiliser arbitrairement l'état actuel.
- Conserver dans le bilan sa version, les numérateurs, les dénominateurs, les formules et sa date d'observation.
- Une correction ultérieure produit une nouvelle version identifiable ; elle ne réécrit pas silencieusement un bilan déjà transmis.
- Pour les périodes antérieures sans historique suffisant, afficher « donnée indisponible » ou « estimation » avec la méthode. Ne pas fabriquer de précision historique.
- Un dénominateur nul produit « non applicable », pas un taux artificiel de 0 % ou 100 %.

### Suppression de compte, purge et anonymisation

Séparer les **photographies détaillées**, encore personnelles tant qu'une réidentification est possible, des **agrégats statistiques conservables**. Les agrégats ne dépendent pas d'une clé étrangère vers un compte supprimable ni d'une jointure vers l'effectif vivant. Pour les métriques de remplacement, figer aussi la méthode, l'échantillon ou les agrégats nécessaires au résultat ; une médiane ne se recalcule pas à partir d'une simple moyenne.

Adapter `retirer-un-compte.sql` et `purger-les-donnees-anciennes.sql` dès l'ajout des photographies, avant toute utilisation réelle :

1. Produire ou vérifier les agrégats historiques nécessaires avant d'effacer leurs sources, y compris lorsqu'une suppression intervient avant la génération du bilan.
2. Supprimer ou anonymiser les détails personnels conformément à la politique de conservation validée. Retirer noms, identifiants, liens vers les comptes et possibilités de recoupement inutiles ; vérifier aussi les journaux, exports conservés et références indirectes.
3. Préserver les numérateurs, dénominateurs et résultats des versions de bilan dont la conservation est autorisée, sans cascade de suppression depuis le compte, la campagne ou les affectations.
4. Vérifier l'ensemble dans une opération cohérente et rejouable : une erreur ne doit pas laisser des données personnelles oubliées ni détruire silencieusement les chiffres. La suppression complète d'un centre suit sa propre politique ; elle ne signifie pas conservation automatique de ses bilans.

**Retirer le nom, remplacer l'identifiant ou mettre `user_id` à `NULL` ne garantit pas l'anonymat.** Dans un petit centre, une combinaison date–qualification rare–équipe peut identifier une personne. Prévoir agrégation, réduction de précision ou masquage des petits groupes selon une méthode à faire valider par le DPO. Si les chiffres exacts restent identifiants, leur conservation demeure encadrée ; privilégier un résultat masqué ou indisponible à une promesse d'anonymisation non démontrée. Voir la [distinction entre anonymisation et pseudonymisation de la CNIL](https://www.cnil.fr/fr/technologies/lanonymisation-de-donnees-personnelles).

### Critères d'acceptation

- Le départ d'un agent ou son changement de rôle ne modifie pas un bilan déjà figé.
- La promotion d'un agent après clôture ne le retire pas des participants historiquement attendus ; un nouvel arrivant n'y est pas ajouté rétroactivement.
- La suppression d'un compte et la purge des campagnes ne changent pas les agrégats conservables, tout en retirant les informations personnelles prévues par la politique validée. Tester aussi la suppression avant génération du bilan.
- Un changement ultérieur de qualification ne réécrit pas la photographie de publication. Une augmentation de besoin ou un retrait effectif avant la garde est reflété dans la photographie de début.
- Un traitement de clôture exécuté en retard et une campagne rouverte n'écrasent pas l'historique de clôture précédent.
- Un effectif suffisant sans les qualifications requises ne compte pas comme couverture complète.
- Le délai de remplacement s'arrête à la publication résolvant le besoin, pas à la première candidature.
- Les appels non résolus, les données manquantes et les dénominateurs restent visibles.
- L'écran, le CSV, l'impression et l'envoi correspondent à la même version du bilan.
- Un double clic sur l'envoi n'entraîne pas deux messages identiques.

## 10. Exigences transversales

- Réutiliser les commandes métier et files existantes avant de créer un mécanisme parallèle.
- Rattacher les nouvelles données au centre et définir les contraintes d'intégrité ainsi que les politiques RLS associées.
- Un agent accède à ses informations autorisées ; un gestionnaire administre uniquement son centre.
- Privilégier les fonctions avec les droits de l'appelant lorsque cela convient. Toute fonction avec droits élevés doit justifier ce choix, vérifier l'identité et les autorisations, fixer son `search_path` et limiter les droits d'exécution.
- Traiter les opérations critiques dans des transactions ; décrire précisément ce qui est atomique et ce qui relève d'une livraison asynchrone.
- Ne pas charger systématiquement tout l'historique dans l'état global du client. Prévoir des lectures bornées adaptées à chaque écran.
- Intégrer les nouvelles tables aux parcours de suppression de compte, d'export des données et de nettoyage du centre. Vérifier les nouvelles clés étrangères.
- Faire valider les durées de conservation applicables aux propositions, appels, journaux et bilans ; ne pas inventer de durée juridique dans le code.
- Respecter l'activation push par appareil et éviter les sollicitations répétitives. Ne pas supposer l'existence d'une préférence email ou de rappel ; la V1 conserve les emails pour les événements concernés et une activation des rappels au niveau du centre.
- Les journaux techniques ne doivent pas contenir les secrets d'accès, liens d'agenda privés ou motifs confidentiels de désistement.
- Prévoir une activation progressive des fonctions et une désactivation des traitements automatiques sans perte des données métier.

## 11. Découpage de livraison

| Lot | Livrable complet                                                                                                                     | Dépendances                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 0   | Recette HTTPS reliée à une base séparée, données fictives et contrat de photographies                                                | Préalable à la validation intégrée de A et D               |
| A   | Traitement planifié, reprises, rappels, relances, photographies des publications unitaires et clôtures, adaptation suppression/purge | Préalable 0 ; files et notifications existantes            |
| B   | Prévisualisation mensuelle, publication transactionnelle, avis groupés, historique des publications                                  | Contrôles existants ; A pour une livraison autonome fiable |
| C   | Appels, propositions, confirmation, clôture et historique des délais                                                                 | A ; règles communes de publication de B                    |
| D   | Flux privé révocable, interfaces d'abonnement et recette sur clients réels                                                           | Publications fiables ; A pour les rappels distincts        |
| E   | Calcul historique versionné, affichage, CSV, impression et envoi explicite                                                           | Historique collecté par A, B et C                          |

Chaque lot comprend le schéma, les droits, le parcours complet, les cas d'erreur, les tests pertinents et la documentation de configuration. Prévoir l'ordre de déploiement des migrations et du code ainsi que les effets d'une désactivation.

## 12. Consignes de développement dans l'IDE

1. Lire `AGENTS.md`, les décisions métier et la version actuelle du dépôt. Avant tout code Next.js, lire les guides pertinents dans `node_modules/next/dist/docs/`, conformément aux instructions du projet.
2. Examiner les modifications utilisateur en cours et les préserver. Relever l'état du dépôt au début de l'intervention ; ne pas se fier à un ancien relevé de fichiers modifiés.
3. Vérifier l'état réel des migrations sur l'environnement cible. La présence d'un fichier ne prouve pas son application ; les migrations du 16 octobre ne doivent pas être présumées appliquées.
4. Travailler lot par lot. Réutiliser les fonctions et conventions présentes ; adapter les noms de modèles proposés plutôt que dupliquer des concepts existants.
5. Ajouter de nouvelles migrations selon le processus du dépôt. Ne pas réécrire une migration déjà appliquée. Mettre à jour les fixtures de schéma nécessaires aux tests.
6. Traiter les droits, contraintes, transactions et courses concurrentes avant de considérer l'interface terminée.
7. Vérifier le préalable 0 et utiliser des données de recette. Ne pas solliciter les vrais agents, envoyer des emails de masse ou activer des traitements en production pour valider le développement. Faire valider les nouveaux arbitrages du §2 avant l'activation du lot concerné ; le code ne doit pas décider silencieusement d'une règle de repos ou d'une durée de conservation.
8. Actualiser le README, le plan de développement et les instructions de recette avec l'état réellement livré et les réglages nécessaires.

Contrôles habituels, à adapter aux scripts présents au moment du développement :

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:e2e
```

Reprendre les vérifications de fuseau prévues par la CI, dont Europe/Paris et UTC. Les tests de base utilisant PGlite et une identité simulée ne remplacent pas la vérification des autorisations et intégrations sur un environnement Supabase de recette.

Les parcours E2E connectés sautés faute d'identifiants ne sont pas des parcours validés. Indiquer explicitement les tests exécutés, les tests sautés et les contrôles externes restant à faire.

Distinguer dans les comptes rendus : **développé**, **testé localement**, **activé sur le site**, **vérifié sur de vrais appareils**. Un lot ne devient pas opérationnel par la seule réussite du build.

## 13. Prompt de démarrage à réutiliser dans l'IDE

```text
Lis AGENTS.md et docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md.
Inspecte la version actuelle du dépôt et les modifications en cours.
Vérifie d'abord le préalable 0 : recette isolée et contrat d'historisation.
Puis réalise le premier lot non terminé dans l'ordre A, B, C, D, E,
en respectant les décisions actées et en signalant les arbitrages recommandés
qui restent à valider avant activation. Ne suppose pas l'existence de préférences
de notification générales ni d'une règle de repos non définie.
Préserve les règles de publication, les droits par centre et les changements
utilisateur. Livre un parcours complet avec migrations, tests et documentation.
Utilise des données de recette pour les validations ; ne déploie pas et
n'active pas d'envois réels vers les agents pendant ces tests.
À la fin, indique les fichiers modifiés, les contrôles exécutés, les migrations
à appliquer et ce qui reste à vérifier avant activation sur le site.
```

Ce prompt est une instruction réutilisable pour un futur travail de développement. La rédaction du présent document n'implémente ni n'active ces fonctionnalités.

## 14. Références techniques

Consulter également le README, les décisions métier, le plan de développement et les documents de recette du dépôt. Les documentations fournisseurs doivent être revérifiées à l'implémentation, notamment pour les limites et la configuration des services.

- [Supabase Cron](https://supabase.com/docs/guides/cron).
- [Planifier des appels à des fonctions avec Supabase](https://supabase.com/docs/guides/functions/schedule-functions).
- [Clés d'idempotence Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).
- [Calendriers et abonnements sur iPhone](https://support.apple.com/fr-fr/guide/iphone/iph3d1110d4/ios).
- [Ajouter un agenda dans Google Agenda](https://support.google.com/calendar/answer/37100?hl=fr).
