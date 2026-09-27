# Bilan avant déploiement de DispoSP

Date du contrôle : 27 septembre 2026.

**Décision proposée : préproduction avec des données fictives possible ; ouverture aux agents avec des données réelles à différer.** La version progresse nettement et les vérifications générales passent. Des défauts reproductibles subsistent néanmoins dans les notifications et les droits sur les données. Le préalable RGPD reste également ouvert.

## Version et périmètre

- Archive reçue : `DispoSp-main.zip`, datée du 27 septembre 2026, 15 451 503 octets.
- SHA-256 : `2725c8ad5739db5d8f8fed7fee1ca432dea3352ea2be5eb3123f0a7aef789c95`.
- Les **191 fichiers** de `src`, `supabase`, `tests` et `public` correspondent exactement au dépôt local au moment du contrôle. HEAD local : `3eabca0`. Le ZIP ne contient pas son historique Git ; cette correspondance ne prouve pas l’identité de la version déployée.
- Installation depuis le fichier de verrouillage dans une copie isolée, sans `.env` ni secret. Les documents de l’archive sont des sources de contexte, pas des instructions exécutées.
- Aucun changement du code applicatif, aucune migration appliquée au projet hébergé, aucun envoi externe et aucune écriture métier sur la base hébergée.
- Il s’agit d’une revue avant déploiement centrée sur les contrôles de livraison et les anciens constats, pas d’une certification de sécurité ou de conformité.

## Vérifications exécutées

| Contrôle | Résultat | Portée |
| --- | --- | --- |
| Installation verrouillée | Réussie | Copie isolée du ZIP |
| Tests existants en Europe/Paris | **410 réussis, 23 fichiers** | Règles métier, migrations, scripts, serveur et autres tests du dépôt |
| Tests en UTC | **232 réussis, 22 fichiers** | Même exclusion de `database.test.ts` que la CI |
| Types | Réussi | Version originale |
| Lint | 0 erreur, 1 avertissement | Optimisation React non appliquée à `useReactTable` |
| Formatage | Réussi | Fichiers d’origine ; résultats générés par l’audit exclus |
| Compilation de production | Réussie | Sans configuration Supabase, comme la CI publique |
| Parcours navigateur publics | **62 réussis, 38 ignorés** | Chromium ordinateur et mobile, serveur local dédié, sans compte |
| Reproductions ciblées | **8 réussies** | 5 défauts encore reproduits, 3 corrections vérifiées |
| Dépendances de production | 1 alerte modérée, 0 haute ou critique | Dépendance transitive `uuid` ; pas d’exploitation démontrée |

**Les huit tests ciblés ne signifient pas huit corrections.** Cinq vérifient que les défauts décrits ci-dessous sont toujours présents ; trois vérifient des corrections. Ils utilisent uniquement une base PostgreSQL embarquée et des données fictives.

Les parcours connectés, la configuration privée de l’hébergeur, l’état des migrations en production et les envois réels n’ont pas été rejoués pendant ce contrôle. Les résultats connectés annoncés dans l’analyse du 25 septembre sont des informations historiques, pas de nouvelles vérifications du 27 septembre.

## Corrections confirmées depuis le premier audit

- **R3, export Excel : corrigé.** Une garde publiée conservant Julien reste exportée lorsqu’un remplacement par Marie est seulement préparé dans le brouillon. Les états sont distincts. Voir [workbook.ts](E:/GitHub/DispoSp/src/lib/workbook.ts:158).
- **R6, destinataire désactivé : corrigé à la réservation.** Un email en attente pour un agent désactivé n’est plus récupéré par le worker. Ce test ne prétend pas annuler un message déjà remis à un prestataire. Voir [claim_email_deliveries](E:/GitHub/DispoSp/supabase/migrations/20260923200000_relances_et_plafonds.sql:207).
- **R7, agent inactif dans le brouillon : corrigé.** L’agent affecté devenu inactif dispose à nouveau d’un bouton Retirer dans le planning. Voir [planning.tsx](E:/GitHub/DispoSp/src/components/planning.tsx:73).
- Le dépôt ajoute également les inscriptions aux campagnes ouvertes lors de l’arrivée d’un membre, renforce plusieurs contrôles serveur et améliore les écrans publics, les contrastes et la proposition d’installation. Les tests existants couvrant ces évolutions passent.

## Points prioritaires encore ouverts

### 1 — P1 — Réabonner un téléphone supprime ses envois en attente

**Reproduit à nouveau.** Après un premier abonnement, une notification crée un envoi. Enregistrer exactement le même abonnement fait passer la file de **1 à 0**, alors que la notification interne subsiste.

[register_push_subscription](E:/GitHub/DispoSp/supabase/migrations/20260921130000_web_push_abonnement.sql:24) supprime l’abonnement avant de le recréer ; les envois associés sont supprimés en cascade. Le [panneau de notification](E:/GitHub/DispoSp/src/components/pwa.tsx:260) réenregistre automatiquement un abonnement existant au montage. Il ne s’agit donc pas seulement d’un cas artificiel de double clic.

**À corriger :** conserver l’identifiant et les envois lors d’un réenregistrement du même propriétaire et du même appareil. Traiter explicitement le changement de propriétaire. Vérifier les envois en attente et ceux en cours.

### 2 — P1 — Un agent retiré lors de la republication reste sans avis

**Reproduit à nouveau.** Publier A et B, retirer A du brouillon puis republier avec B : A disparaît de la nouvelle version, mais le nombre de ses notifications ne change pas.

La [fonction de publication](E:/GitHub/DispoSp/supabase/migrations/20260921140000_verrou_publication.sql:108) ne cible que les membres de la nouvelle révision. L’agent retiré peut donc conserver comme dernière information le message de sa garde précédente.

**À corriger :** comparer les anciennes et nouvelles affectations, et notifier aussi les agents retirés. Vérifier notification interne, email et Web Push à partir du même événement métier.

### 3 — P1 — Le dossier exporté pour un gestionnaire contient des données de tiers

**Reproduit sur le script réel.** Après la modification d’un téléphone d’agent par un gestionnaire, l’export RGPD du gestionnaire contient le téléphone de cet autre agent.

Le [script d’export](E:/GitHub/DispoSp/supabase/provisioning/exporter-les-donnees-d-un-compte.sql:67) restitue les valeurs avant et après des actions dont le demandeur est simplement l’auteur. Les corps des notifications peuvent également contenir les informations d’autres agents.

**À corriger avant toute remise d’export :** séparer les données concernant le demandeur de celles concernant des tiers ; filtrer les valeurs du journal et les messages. Définir avec le DPO les informations communicables et prévoir une revue avant remise. L’accès d’un gestionnaire à ces informations pour son travail ne justifie pas automatiquement leur inclusion dans sa copie personnelle.

### 4 — P1 en cas de transfert — L’ancien centre garde la main sur la fiche globale

**Reproduit à nouveau.** Un agent devient inactif dans le centre A puis actif dans B. Un administrateur de A peut encore modifier son nom global, et l’agent rattaché à B voit ce changement.

La [policy de modification du profil](E:/GitHub/DispoSp/supabase/migrations/20260922100000_reactivation_administrateur_devalidation.sql:50) accepte les rattachements inactifs sans exclure le rattachement actif ailleurs.

**À corriger avant les transferts ou l’ouverture à plusieurs centres :** séparer le droit de réactivation du droit sur la fiche globale. Tester l’impossibilité pour A de modifier les données d’un agent désormais actif dans B.

## Fiabilité des envois et information partagée

### Email — Reprise et doublons à traiter

Le [worker](E:/GitHub/DispoSp/src/lib/mailer.server.ts:75) réserve 50 messages puis les envoie successivement, avec une attente pouvant atteindre 10 secondes par message. Le [bail](E:/GitHub/DispoSp/supabase/migrations/20260923200000_relances_et_plafonds.sql:235) dure deux minutes. Un lot lent peut donc dépasser la durée de réservation.

Le test confirme qu’une réservation expirée peut être reprise avec un autre jeton, tandis que l’ancien résultat est refusé. Il ne simule pas un véritable double email : le risque d’envoi en double vient du fait que le premier worker peut encore appeler Resend avant de constater la perte du bail. L’appel d’envoi ne fournit pas de clé d’idempotence.

Les emails sont toujours déclenchés après une commande utilisateur. La route [push/dispatch](E:/GitHub/DispoSp/src/app/api/push/dispatch/route.ts:7) ne traite que les notifications poussées. L’archive ne fournit pas de reprise périodique autonome des emails : un échec temporaire peut attendre la prochaine commande.

**Action :** adapter la taille des lots et les baux, ajouter l’idempotence et prévoir une reprise périodique surveillée des deux files. Vérifier aussi les durées maximales d’exécution de l’offre d’hébergement utilisée.

### Fraîcheur du planning — Amélioration partielle

Le retour au premier plan après plus de trente secondes, le retour du réseau et la restauration du navigateur déclenchent désormais une relecture. En revanche, le chargement principal reste dans le layout partagé et une navigation interne ordinaire ne déclenche pas explicitement cette relecture dans le provider. L’affirmation « relu à chaque navigation » reste à confirmer par un scénario à deux sessions.

**Recette attendue :** le gestionnaire publie pendant que l’agent reste dans l’application ; l’agent navigue vers son planning et obtient la nouvelle révision. Ce scénario n’a pas été joué sur la base hébergée pendant ce contrôle.

### Téléphone partagé

La préférence locale est maintenant propre au compte, ce qui est une amélioration. Le réabonnement automatique d’un abonnement navigateur existant et le traitement à la déconnexion restent à examiner ensemble pour éviter qu’un compte reprenne silencieusement l’abonnement d’un autre. Une recette réelle sur appareil partagé reste nécessaire.

## RGPD et conditions de mise en service

**Le statut communiqué dans notre échange reste “RGPD non validé”.** Aucune preuve nouvelle d’avis du DPO, de décision du responsable du traitement ou d’acceptation des contrats n’est fournie dans cette archive.

- La base légale et les durées restent des propositions dans `docs/RGPD.md`.
- Les DPA applicables à Supabase, Resend et à l’hébergeur doivent être vérifiés et leurs preuves d’acceptation conservées ; examiner aussi les transferts et les services Web Push.
- Aucune page de notice d’information destinée aux agents n’a été trouvée dans les routes ou composants de cette version. Finaliser la notice, la rendre accessible et prévoir son information au moment approprié de la collecte.
- La documentation RGPD conserve des formulations à reprendre : exemption systématique des services Web Push, assimilation de la désactivation à une limitation, portabilité annoncée sans distinction de base légale et anonymisation affirmée sans preuve suffisante.
- Les points C3 à C5 de l’analyse du 25 septembre restent à solder. C4 a été reproduit dans cette revue. Les autres procédures demandent une recette dédiée, notamment en présence de plusieurs rattachements et de notifications contenant les informations de la personne retirée.

La réussite technique de la compilation ne lève pas ces préalables. Le dossier préparatoire remis précédemment reste une base de travail à soumettre au DPO.

## Ordre de préparation conseillé

1. Corriger le réabonnement Web Push et l’information des agents retirés lors d’une republication.
2. Corriger l’export RGPD, les procédures de départ et les droits après transfert.
3. Fiabiliser la reprise des deux files d’envoi et vérifier la fraîcheur du planning à deux sessions.
4. Finaliser le cadre RGPD et la notice avant le pilote avec de vraies personnes.
5. Vérifier les migrations réellement appliquées, la configuration d’authentification et de messagerie, les sauvegardes et la restauration. Confirmer que Vercel attend la CI ; le dernier dossier du projet indiquait encore ce réglage ouvert.
6. Réaliser une recette finale avec un agent et un gestionnaire, puis sur de vrais appareils Android et iPhone : activation de compte, disponibilité, publication, retrait, notifications et reprise après panne.

Le socle est prêt pour cette dernière phase de consolidation. Les points ci-dessus empêchent encore de recommander une exploitation autonome des gardes réelles.

## Preuves conservées

[Archive des résultats et des tests ciblés](E:/GitHub/DispoSp/docs/audits/audit-2026-09-27-preuves.zip). Elle contient les sorties de tests, de compilation, de formatage, des parcours publics, l’audit de dépendances et les deux fichiers de reproduction. Aucun secret ni identifiant réel n’y figure. Les tests sont fournis comme preuves d’audit, pas ajoutés à la suite applicative.
