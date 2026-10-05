# Contrôle des correctifs du bilan du 27 septembre 2026

Cette note complète le bilan initial, qui portait sur le ZIP antérieur aux correctifs. Elle porte sur les fichiers locaux modifiés et la migration `20260927090000_correctifs_bilan.sql`.

## Résultat de cette vérification

**217 tests ciblés réussis dans trois fichiers** : `database.test.ts`, `mailer.test.ts` et `push-routes.test.ts`, en Europe/Paris. Les tests utilisent une base fictive et des services d’envoi simulés. Aucun email ni notification n’a été envoyé par ce contrôle ; aucune migration n’a été appliquée à la base hébergée.

Les 437 tests globaux, 235 tests UTC et 96 parcours E2E annoncés par le porteur du projet sont consignés comme résultats fournis. Ils n’ont pas été tous rejoués pendant cette vérification ciblée.

## État actualisé

| Point                                             | État dans la version locale                                       | Limite                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| N° 1 — Réabonnement sans perte                    | Corrigé et couvert par les tests ciblés                           | À activer en production par la migration                                   |
| N° 2 — Information de l’agent retiré              | Corrigé et couvert par les tests ciblés                           | Réception réelle des trois canaux à vérifier                               |
| N° 3 — Export RGPD contenant les données de tiers | **Toujours ouvert**                                               | Le script d’export est inchangé                                            |
| N° 4 — Modification depuis l’ancien centre        | Corrigé et couvert par les tests ciblés                           | La lecture de la fiche globale reste autorisée                             |
| Téléphone partagé                                 | Réclamation explicite et réabonnement du propriétaire implémentés | La libération à la déconnexion reste une tentative, limitée à 2,5 secondes |
| Relecture à la navigation                         | Implémentée lorsque les données ont plus de 30 secondes           | Pas une synchronisation instantanée ; scénario E2E annoncé par le porteur  |
| Emails                                            | Lots de 10 et clé d’idempotence implémentés et testés             | Réserves sur les changements de clé et absence de reprise autonome         |

Le script d’export [exporter-les-donnees-d-un-compte.sql](E:/GitHub/DispoSp/supabase/provisioning/exporter-les-donnees-d-un-compte.sql:67) conserve les valeurs avant/après des actions dont le demandeur est l’auteur. Le défaut n° 3 du bilan initial n’est donc pas couvert par cette migration. Les cinq correctifs décrits dans la migration ont leur propre numérotation ; ils ne sont pas les cinq reproductions du bilan initial.

## Deux limites à ne pas confondre avec des corrections complètes

### Lecture depuis un ancien centre

Le choix de conserver le nom historique est compréhensible, mais la policy autorise la lecture de la fiche globale, y compris les coordonnées actuelles : elle ne limite pas la lecture au nom nécessaire aux anciennes gardes. Avant les transferts entre plusieurs centres, prévoir une représentation historique des informations nécessaires ou un accès limité aux champs justifiés, plutôt qu’une ouverture de toute la fiche actuelle.

### Idempotence des emails

Le code traite correctement le `409 concurrent_idempotent_requests` comme une situation incertaine : il conserve la clé pour la reprise. Cela correspond à la [documentation Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).

En revanche, la migration change automatiquement de clé après un 5xx ou un autre 409. La documentation consultée ne garantit pas qu’un 5xx signifie qu’aucun effet n’a eu lieu ; un `invalid_idempotent_request` signifie que le contenu diffère, sans prouver que la première demande n’a pas envoyé l’email. Je ne considère donc pas l’absence de doublons comme entièrement démontrée. Aucun doublon réel chez Resend n’a été reproduit pendant cette revue.

Recommandation : conserver une demande d’envoi stable et sa clé pour une même notification, et traiter séparément un changement de contenu ou de destinataire. Faire confirmer le traitement des erreurs ambiguës par le contrat du service avant d’annoncer une garantie d’envoi unique. Resend conserve les clés pendant **24 heures** : une reprise plus tardive exige aussi une décision explicite.

La reprise automatique reste un sujet distinct. `dispatchEmails` est déclenché après une commande utilisateur ; la route `/api/push/dispatch` ne traite que le Web Push. Les lots plus petits et l’idempotence ne déclenchent aucun nouvel essai lorsque personne n’utilise l’application.

## Avant le déploiement

1. **Appliquer puis vérifier la migration avant le nouveau code.** Le README la marque encore « Non appliquée ». La route d’abonnement utilise désormais le paramètre `claim` ; le worker attend la nouvelle clé d’envoi. Cette revue n’atteste pas l’état de la base hébergée.
2. Corriger l’export RGPD avant toute remise de données à un demandeur et poursuivre la revue des procédures de départ.
3. Prévoir une reprise périodique surveillée des deux files, et cadrer les changements de clé d’idempotence.
4. Finaliser le préalable RGPD et la notice aux agents avant un pilote sur de vraies données. Aucun accord nouveau n’a été fourni dans ce suivi.
5. Vérifier les envois réels et la déconnexion sur de vrais appareils, y compris en cas de réseau lent. La déconnexion reste fonctionnelle sans JavaScript, mais la libération de l’abonnement dépend du code navigateur et du succès de la requête.

**Conclusion : plusieurs défauts du bilan initial peuvent être clos côté code. Le feu vert pour les données réelles reste conditionné aux points encore ouverts et à la vérification du déploiement effectif.**

## Actualisation du 1er octobre 2026

Le porteur du projet confirme que la migration `20260927090000_correctifs_bilan.sql` est appliquée au projet Supabase du site. Le point relatif à son application est donc levé sur cette confirmation ; l'état de la base hébergée n'a pas été contrôlé directement.

La nouvelle archive `DispoSp-main.zip` contient les correctifs décrits dans cette note. Ses 192 fichiers applicatifs, migrations, tests et ressources publiques correspondent à la copie de travail. Empreinte SHA-256 de l'archive : `128b90efc94fa1d47e1601229bc31cb2fda47d291dc64470f2452e17b4c60efa`.

Vérifications rejouées sur une extraction isolée : **437 tests réussis dans 23 fichiers en Europe/Paris**, puis **235 tests applicatifs réussis dans 22 fichiers en UTC** (hors tests de base), contrôle des types réussi, compilation de production réussie, lint sans erreur avec un avertissement existant concernant TanStack Table et React Compiler. Le contrôle de mise en forme de l'archive échoue uniquement sur `docs/BILAN_AVANT_DEPLOIEMENT_2026-09-27.md` ; sa mise en forme est corrigée dans la copie de travail, dont le contrôle global de mise en forme passe désormais. Les parcours E2E et les réceptions sur de vrais appareils n'ont pas été rejoués dans ce contrôle.

Les réserves sur l'export RGPD, la reprise autonome des emails, les changements de clé d'idempotence, les lectures après transfert entre centres et les validations RGPD restent ouvertes. **La version compile pour un déploiement technique ; ces résultats ne constituent pas un feu vert sans réserve pour la mise en service sur des données réelles.**
