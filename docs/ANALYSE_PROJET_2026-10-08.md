# Analyse de DispoSP au 8 octobre 2026

## Conclusion

La version fournie progresse nettement : les corrections du 5 octobre, les qualifications de conduite et l'optimisation des règles d'accès du 7 octobre sont présentes. **483 tests passent**, ainsi que les contrôles des types, du lint, du formatage et la compilation de production. Le projet est techniquement constructible et ses règles métier bénéficient d'une couverture de tests solide.

**Je recommande toutefois de traiter les alertes de dépendances avant une nouvelle mise en production, de corriger l'export RGPD avant toute remise de données et de terminer la reprise autonome des emails.** La confirmation des migrations lève l'incertitude documentaire sur leur application ; elle ne vaut pas contrôle du code effectivement déployé, des services d'envoi ou validation RGPD.

## Version examinée et limites de la revue

- Archive : `DispoSp-main.zip`, fournie le 8 octobre 2026, 15 529 026 octets.
- SHA-256 : `7e841f8cb4278bc4c099fb72d59c0f2dd58eb8193a0e1ce3919406a22d041544`.
- Les 196 fichiers des dossiers `src`, `supabase`, `tests` et `public` présents dans l'archive correspondent à la copie de travail.
- Installation depuis le verrouillage des dépendances dans une extraction isolée, sans copie des secrets.
- Relecture des évolutions depuis la version du 1er octobre, des parcours des gestionnaires, des migrations et des points ouverts des précédents bilans.
- Les quatre migrations des 5 et 7 octobre sont **appliquées au projet du site selon la confirmation du porteur du projet le 8 octobre**. Celle du 27 septembre avait déjà été confirmée appliquée le 1er octobre.
- Aucun accès à la base hébergée, aucune modification de donnée métier, aucun email et aucune notification réelle envoyés pendant ce contrôle.
- Les parcours navigateur connectés, la réception sur téléphone et les mesures de performance à volume réel n'ont pas été rejoués. Les résultats des audits antérieurs sont distingués des vérifications de ce jour. Cette revue ne constitue pas un test d'intrusion exhaustif.

## Vérifications rejouées

| Contrôle                                        | Résultat du 8 octobre                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Tests métier, serveur et schéma en Europe/Paris | 483 réussis dans 23 fichiers                                                                  |
| Tests hors `database.test.ts` en UTC            | 251 réussis dans 22 fichiers ; les tests de provisionnement restent inclus                    |
| Types                                           | Réussi                                                                                        |
| Lint                                            | Aucune erreur ; un avertissement existant de React Compiler sur TanStack Table                |
| Mise en forme de l'archive                      | Réussie                                                                                       |
| Compilation de production                       | Réussie                                                                                       |
| Audit des dépendances de production             | 10 avis : 1 critique, 3 élevés, 5 modérés, 1 faible ; exploitation dans DispoSP non démontrée |

Les tests de schéma appliquent les 32 migrations sur une base PGlite locale, avec un schéma d'authentification simulé. Ils vérifient notamment les droits, les publications et les nouvelles règles de conduite ; ils ne remplacent pas une recette complète sur les services Supabase hébergés.

## Évolutions confirmées dans le code

### Désistements et réaffectations

Les écrans de planning personnel et de demandes tiennent désormais compte de la publication postérieure à une décision de désistement. Un agent réaffecté n'est plus présenté comme encore délié de la nouvelle version. Le vivier rappelle le désistement accepté ; une nouvelle demande après un refus est possible. La règle commune se trouve dans `src/lib/domain.ts` (`relieves`, `relievedFrom`, `latestWithdrawal`).

### Campagnes et administration

La réactivation d'un administrateur exige un administrateur, côté base comme côté écran. Le déverrouillage d'une campagne avant clôture inscrit les membres actifs de l'équipe arrivés pendant le verrouillage. La grille du tableau de bord adapte ses colonnes à la longueur du mois. Les exports nomment plus explicitement la couverture potentielle et la couverture planifiée du brouillon.

### Emails

Une erreur de compte Resend, telle qu'un domaine non vérifié, une clé refusée ou un quota, suspend le lot au lieu de déclarer tous les destinataires en échec. La migration `20261005120000_suspension_file_email.sql` et `src/lib/mailer.server.ts` préservent ainsi les messages pour une nouvelle tentative. Cette suspension ne crée cependant aucun planificateur de reprise.

### Conduite

L'invitation et la fiche proposent Aucun, COD SSR, PL, COD2 ou COD6. La conduite rejoint les qualifications à l'acceptation de l'invitation et peut être exigée dans les besoins. Un seul de ces codes est enregistré par agent et par centre dans le parcours normal, contrôlé par la migration `20261007090000_conduite.sql`.

### Performance

La migration `20261007150000_droits_par_ensemble.sql` remplace les appels aux fonctions de droits ligne par ligne par la recherche dans l'ensemble des centres autorisés. Les tests de droits passent sur ce schéma. Le rapport du 7 octobre annonce une lecture des affectations ramenée de 13,6 s à 0,14 s sur sa pile locale ; **ces chronométrages n'ont pas été reproduits dans cette revue**, et ne préjugent pas des temps du site hébergé.

## Points à traiter

### Priorité 1 — Actualiser les dépendances de production

L'audit du verrouillage signale dix avis au 8 octobre. Next.js est encore en `16.3.5`. Les correctifs indiqués par les avis Next.js vont jusqu'à `16.3.8` ; une mise à jour compatible, avec `eslint-config-next` aligné et un nouveau verrouillage, doit être testée. Il faut ensuite relancer l'audit : une mise à jour de Next.js ne garantit pas à elle seule la disparition de toutes les alertes transitives.

| Dépendance                           | Niveau maximal signalé | Version corrigée indiquée par les avis consultés                          |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------- |
| Next.js                              | Critique               | 16.3.6 pour ImageResponse ; 16.3.8 pour les autres avis relevés           |
| sharp via Next.js                    | Élevé                  | 0.35.5 ou supérieure                                                      |
| source-map-js via Next.js et PostCSS | Élevé                  | 1.2.2 ou supérieure                                                       |
| uuid via ExcelJS                     | Modéré                 | 11.1.1 ou supérieure ; vérifier la compatibilité de la dépendance parente |

L'avis critique concerne des données contrôlées par un attaquant injectées dans du SVG rendu par `next/og` et `ImageResponse` côté Node.js. Aucun usage de ces API n'a été retrouvé dans `src` : **l'audit de paquet ne démontre donc pas une exécution de code exploitable dans cette application**. `next/image` est utilisé pour la marque, avec des ressources locales, et aucune configuration d'images distantes n'est présente dans `next.config.ts`. Les autres chemins concernés par les avis demandent une qualification propre ; aucun essai d'exploitation n'a été lancé.

Sources primaires consultées : [avis Next.js sur ImageResponse](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), [avis Next.js sur l'optimisation des images](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4). Le relevé brut et les dix liens sont conservés dans `docs/audits/dependances-2026-10-08.json`.

### Priorité 1 — Filtrer les données de tiers dans l'export RGPD

`supabase/provisioning/exporter-les-donnees-d-un-compte.sql` est inchangé. La partie `journal` reprend intégralement `old_value` et `new_value` dès que le demandeur est l'auteur d'une action. L'export d'un gestionnaire peut donc inclure les fiches d'autres agents qu'il a modifiées. Les corps de notifications peuvent aussi mentionner des tiers.

Prévoir une sélection des champs portant sur le demandeur et une revue des textes avant remise. Il s'agit du script de réponse à une demande individuelle, distinct du CSV de disponibilités ou du classeur opérationnel utilisé par les gestionnaires. Cette faiblesse avait été reproduite dans le précédent bilan ; sa cause est toujours présente par relecture du script.

### Priorité 2 — Déclencher réellement les reprises d'emails

`dispatchEmails` reste appelé après une commande utilisateur dans `src/app/actions.ts`. La route `src/app/api/push/dispatch/route.ts` ne traite que le Web Push. Aucune reprise périodique des emails n'est présente dans l'archive. Après une suspension ou une panne, la date de reprise rend le message éligible mais ne lance pas son envoi : sans nouvelle action, il peut rester en attente.

Prévoir un déclenchement périodique protégé et surveillé, avec visibilité sur les messages en attente, suspendus et abandonnés. La suspension introduit aussi une limite de trois jours. La réserve précédente sur les changements de clé d'idempotence après certaines erreurs reste ouverte ; aucun doublon réel n'a été reproduit ici.

### Décision métier — Clarifier les équivalences de conduite

`coverage()` compte les libellés exacts par `qualifications.includes(name)`. Les valeurs proposées par défaut pour les besoins comportent encore `Conducteur PL`, tandis que le nouveau champ Conduite propose `PL`. Par conséquent, sélectionner PL dans une fiche ne satisfait pas automatiquement un besoin Conducteur PL ; COD2 ou COD6 ne satisfait pas non plus automatiquement un besoin PL.

Ce fonctionnement n'est pas nécessairement contraire au besoin métier, mais doit être décidé explicitement avant la saisie réelle. Harmoniser le catalogue et les besoins ; si des équivalences sont souhaitées, les définir et les tester côté calcul et publication. Le guide explique le fonctionnement actuel sans inventer de hiérarchie entre codes.

### Exploitation et protection des données

La lecture de la fiche globale par un ancien centre reste possible après un transfert ; la restriction d'écriture demeure, mais ne limite pas les champs lus. À régler avant les usages avec transferts entre centres.

Le document `docs/RGPD.md` indique toujours des validations et documents à finaliser, notamment la base légale, les durées et la notice. Aucun nouvel accord du DPO n'a été fourni dans ce tour. Il faut distinguer ces validations de la réussite des tests techniques.

Enfin, le chargement de l'état global du centre sur plusieurs mois est inchangé : l'optimisation des droits SQL traite le principal coût identifié, mais pas le volume transmis et retraité à chaque navigation ou écriture. Une mesure sur le centre pilote reste utile avant d'engager la suite de l'optimisation décrite dans l'audit de performance.

## Guide livré et suite recommandée

Le guide Word de dix pages couvre la connexion, les droits des gestionnaires, les invitations, les campagnes, les réponses validées, les besoins, les qualifications de conduite, les affectations, la publication, les désistements, les notifications et les exports. Il emploie les libellés des écrans et distingue les actions du gestionnaire de celles réservées à un administrateur.

Ordre proposé : mettre à jour les dépendances et rejouer les contrôles ; corriger l'export individuel ; mettre en place la reprise périodique des emails ; arrêter la règle de conduite avec le centre ; finaliser les validations d'exploitation et de protection des données puis réaliser une recette sur de vrais appareils. Aucune modification du code applicatif ni déploiement n'a été réalisé pendant cette analyse.
