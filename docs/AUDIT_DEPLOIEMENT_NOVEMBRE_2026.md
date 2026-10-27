# DispoSP — audit avant ouverture de novembre 2026

Audit du **27 octobre 2026**, sur le commit **`07a5526ff31cbe1b8cbc76e5f92bfb07a01f66da`** (« correction B1 et C8 »). Dates et échéances exprimées à l'heure de Paris.

## Décision proposée

**Le socle est solide, mais je ne recommande pas encore une ouverture opérationnelle sans réserves.** La construction de production et les 608 tests existants passent. Les contrôles de session, les droits en base et la séparation entre brouillon et publication sont bien structurés. Les refus d'accès anonyme sont également constatés sur l'hébergement.

Les défauts les plus importants concernent **le remplacement après clôture**, **les agents arrivant après la campagne** et **la mise en production avant la fin des tests**. Il faut aussi choisir maintenant comment sera ouverte la première campagne réelle : au moment de l'audit, le compte d'essai ne voit qu'une campagne d'octobre, déjà close.

Un lancement début novembre reste envisageable après correction des points A01 à A03 et validation des conditions d'ouverture ci-dessous. Ce verdict porte sur la préparation technique observée ; il ne vaut ni certification de sécurité, ni validation juridique, ni preuve de fonctionnement sur téléphone réel.

### Conditions pour donner le feu vert

| Condition                                                 | État constaté                       | Preuve attendue avant ouverture                                                                                           |
| --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Un remplacement élargi va jusqu'à la publication          | **Bloquant : A01**                  | Un agent sans disponibilité validée se propose, est retenu, puis reçoit une affectation publiée depuis le parcours normal |
| Un agent arrivé après clôture peut répondre à son appel   | **Bloquant pour ce parcours : A02** | Accès à l'appel et déclaration portant les horaires exacts, même sans participation préalable à la campagne               |
| Une version n'arrive en production qu'après les contrôles | **Non : A03**                       | Promotion conditionnée au succès du contrôle `verify`                                                                     |
| Première campagne et date limite décidées                 | **À décider : A04**                 | Novembre initialisé par une procédure explicitement choisie, ou lancement sur décembre                                    |
| Notice d'information et responsabilités validées          | **Non établi par l'audit : A11**    | Notice remise, contact identifié, décisions de conservation et sous-traitance consignées                                  |
| Sauvegarde et restauration utilisables                    | **Non vérifié**                     | Restauration réussie sur un environnement séparé ; responsable et délai de reprise définis                                |
| Invitation, récupération, email, push et agenda éprouvés  | **Validation partielle seulement**  | Un parcours réel de chaque mécanisme avec des comptes de recette et des appareils représentatifs                          |

## Périmètre et méthode

Lecture des instructions du dépôt et des guides Next.js installés, revue de l'authentification, des actions serveur et routes API, du chargement des données, des règles métier, des 40 migrations et scripts d'administration ; examen des tests, de la configuration et de la documentation d'exploitation. Exécution des contrôles locaux, consultation des résultats GitHub et Vercel, lectures anonymes sur Supabase et connexion avec le compte `E2E` déjà configuré.

Les défauts de données ont été reproduits dans **une base locale PGlite**, en appliquant les migrations du dépôt. Les écrans ont été testés avec Playwright sur une construction locale de production reliée au projet configuré. Le compte d'essai est **ADMIN** : cela limite la portée des résultats sur les parcours agents.

**Aucun code applicatif ni migration n'a été modifié.** Aucune campagne, invitation, affectation, notification ou donnée métier n'a été créée ou changée sur le projet hébergé. Les essais d'authentification créent naturellement des sessions et des traces de connexion. Aucun email ni push de recette n'a été déclenché.

Les fichiers de travail sont dans `.local/audit-deploiement-20261027/`. L'[archive de preuves](audits/audit-deploiement-2026-10-27-preuves.zip) contient les résultats utiles et les contre-épreuves, sans fichier `.env`, cookie, mot de passe ni trace navigateur contenant une session.

### Limites d'accès

Le connecteur Supabase disponible ne liste pas le projet configuré dans ce dépôt. Les lectures du projet ont donc utilisé son API et le compte d'essai ; **l'historique exact des migrations hébergées, les Security Advisors, le réglage SMTP, les sauvegardes, la protection des mots de passe et les droits des comptes techniques n'ont pas été inspectés dans le panneau d'administration**. Les résultats sur les droits SQL concernent le schéma reconstruit localement ; les contrôles anonymes et l'état des traitements concernent, eux, le projet hébergé.

Pas de test de charge sur la production, pas de test destructif, pas de simulation de deux connexions PostgreSQL concurrentes, pas de validation VoiceOver/TalkBack ni d'iPhone physique. L'émulation iPhone de la suite utilise Chromium, pas Safari/WebKit.

## Résultats vérifiés

| Contrôle                           | Résultat actuel                                                  | Portée                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Git au départ                      | Arbre de travail propre                                          | Commit identifié ci-dessus                                                                                                                     |
| Formatage                          | Réussi                                                           | Ensemble des fichiers suivis par la configuration                                                                                              |
| TypeScript                         | Réussi                                                           | `pnpm typecheck`                                                                                                                               |
| Lint                               | 0 erreur, 1 avertissement                                        | `useReactTable`, `react-hooks/incompatible-library`, `availability-table.tsx:122`                                                              |
| Tests locaux existants             | **608/608**, 27 fichiers                                         | `pnpm test`, 252 s, après contournement des restrictions d'exécution Windows                                                                   |
| CI du même commit                  | **608/608** ; **299/299 en UTC**                                 | La seconde passe exclut `database.test.ts` ; construction réussie                                                                              |
| Navigateur en CI                   | **62 réussis, 42 ignorés**                                       | Surface publique, sans base ni compte connecté                                                                                                 |
| Navigateur connecté local          | **93 réussis, 3 échecs, 8 ignorés**                              | Ordinateur et mobile, compte ADMIN ; analyse A08                                                                                               |
| Contre-épreuves métier et sécurité | **17 réussites, 7 échecs attendus sur le code actuel**, 24 tests | Les échecs reproduisent A01, A02, A05, A06 et A09 ; ils sont distincts de la suite officielle verte                                            |
| Construction locale                | Webpack réussi                                                   | Turbopack échoue ici au démarrage d'un processus de transformation CSS, y compris hors environnement restreint ; Turbopack réussit en CI Linux |
| Dépendances de production          | **1 avis élevé, 1 modéré, 0 critique**                           | `pnpm audit --prod --json`, détail A12                                                                                                         |
| Tables publiques, schéma local     | **26/26 avec RLS**, aucune ouverte à `anon`                      | Contrôle du catalogue après toutes les migrations                                                                                              |
| Tables privées, schéma local       | Aucun accès de table accordé à `anon` ou `authenticated`         | Catalogue complet ; contrôles complémentaires des fonctions privilégiées                                                                       |
| Accès anonyme hébergé              | **11 tables interrogées, 11 refus `42501`**                      | Organisations, profils, rattachements, campagnes, disponibilités, affectations, appels, propositions, agendas, notifications, audit            |

Le [contrôle GitHub du commit audité](https://github.com/emifrog/DispoSp/actions/runs/40506590673) est terminé en succès. L'ancien problème de version Next.js et les dates de tests corrigées par le commit `07a5526` ne sont donc **pas repris comme défauts ouverts** de cette version.

### Ce qui fonctionne sur l'hébergement

- `/connexion`, le manifeste et `sw.js` répondent 200 ; `/tableau-de-bord` renvoie le visiteur vers la connexion.
- `/api/export` et `/api/planning/mois` répondent 401 sans session ; un faux jeton d'agenda répond 404 avec `private, no-store`.
- HSTS, protection contre l'affichage en cadre, politique de contenu et interdiction de cache du service worker sont présents. Une réponse dynamique observée porte la région d'exécution Vercel `dub1` ; ce constat n'est pas une vérification de tous les réglages de résidence des données.
- `scheduled_status(org)` rapporte des passages de génération et de livraison à **13 h 55**, zéro erreur sur 24 h, zéro email en échec sur 24 h et aucune livraison en attente au moment du contrôle. Cela prouve le passage des tâches, pas la réception réelle par un destinataire.
- Confirmation des adresses activée (`mailer_autoconfirm: false`). Les inscriptions publiques restent ouvertes : voir A07.

## Défauts et actions prioritaires

Les priorités désignent l'impact sur ce lancement : **P1** à régler avant d'utiliser le parcours concerné ou d'ouvrir la production ; **P2** à traiter avant le premier usage concerné ; **P3** amélioration sans blocage général. Une condition non vérifiée est explicitement distinguée d'un défaut reproduit.

### A01 — P1 — Le remplacement sur déclaration ne peut pas être publié depuis son écran

**Reproduit.** Après élargissement d'un appel, un agent sans disponibilité validée déclare être disponible ; le gestionnaire le retient. La base accepte cette preuve, mais `coverage()` continue à le classer invalide. « Confirmer et publier » et la publication unitaire restent désactivés.

Preuves : `src/lib/domain.ts:650-671`, `src/components/calls.tsx:382`, `src/components/planning.tsx:451`. Le SQL reconnaît les propositions déclarées retenues ou confirmées et vérifie leurs horaires dans `20261021090000_appels_remplacement.sql:278-284`. La contre-épreuve `ecrans/couverture-declaration.test.ts` échoue toujours sur ce commit.

**Correction :** aligner l'éligibilité affichée sur la règle de la base, montrer « Sur déclaration », et garder la vérification définitive en base. La publication du mois peut contourner le problème, mais c'est un autre parcours, avec un périmètre plus large ; elle ne remplace pas une correction.

**Acceptation :** cas `SELECTED` puis `CONFIRMED` valides, déclaration absente ou retirée refusée, droits et horaires contrôlés à la publication.

### A02 — P1 — Un nouvel agent peut recevoir un appel qu'il ne peut pas ouvrir correctement

**Reproduit au niveau domaine et rendu du composant ; garde du layout vérifié dans le code.** Le recrutement par appel dépend de l'équipe, alors que les campagnes visibles d'un agent sont limitées à celles dont il est participant. Un agent arrivé après clôture peut être sollicité sans être participant.

Deux conséquences : s'il n'a aucune campagne visible, le layout affiche `NoCampaign` même pour `/appels` ; s'il en a une autre, l'appel s'affiche sans son contexte horaire et la déclaration indique **« de 0 h à 0 h le lendemain »**. La base enregistre pourtant les horaires réels.

Preuves : `src/lib/domain.ts:590`, `src/app/(workspace)/layout.tsx:40-43`, `src/components/calls.tsx:129-150`, `20260925090000_participants_en_cours.sql` et `20261021090000_appels_remplacement.sql:735-770`. Deux contre-épreuves ajoutées dans `complements.test.ts` reproduisent l'absence de campagne et le texte erroné.

**Correction :** donner aux appels leur contexte de campagne et leurs horaires, et permettre l'accès aux écrans personnels utiles sans campagne de saisie. Ne pas inscrire artificiellement l'agent dans une campagne close uniquement pour contourner l'affichage.

**Acceptation :** nouvel agent sans aucune participation, agent participant à un autre mois, jour/nuit et horaires personnalisés ; déclaration affichée identique à celle conservée en base.

### A03 — P1 — La production est publiée avant la fin des tests

**Constaté sur le commit actuel.** Le déploiement Production `7358847532` est en succès le 27 octobre à **13:48:22**. Le travail GitHub `verify` termine à **13:51:42**, soit **3 min 20 s après**. Une erreur de test ne peut donc pas empêcher cette publication.

**Correction :** conditionner la promotion en production à `verify` dans les contrôles de déploiement de l'hébergeur, ou mettre en place une promotion explicite après CI verte. Vérifier le réglage sur une préversion, sans provoquer volontairement une panne de production.

**Acceptation :** conserver la preuve qu'une version en échec reste non promue, puis que le commit corrigé est promu après les tests. Le README explique déjà ce besoin, mais le comportement observé reste inchangé.

### A04 — Décision avant le 1er novembre — Quelle première campagne ouvrir ?

**Règle confirmée, pas une régression.** L'interface exige une clôture antérieure au mois planifié ; la base refuse une clôture déjà passée. Une campagne de novembre ne pourra donc plus être créée par l'interface à partir du **1er novembre**. Le script initial utilise `month_offset = 1` : lancé en novembre, il crée décembre.

Preuves : `src/lib/domain.ts:746-757`, `20261016150000_encadrement_hors_campagnes.sql:76-78`, `supabase/provisioning/premiere-campagne.sql:18,63-77`. La lecture actuelle du compte ADMIN ne montre qu'octobre, avec clôture au 30 septembre.

**Choix à consigner :** ouvrir novembre avant fin octobre avec une échéance réaliste, préparer explicitement une campagne de démarrage en cours de mois par la procédure administrative adaptée, ou démarrer la collecte pour décembre en tenant novembre par le dispositif existant. Ne pas lancer le script par défaut en supposant qu'il créera novembre.

### A05 — P2 — Annuler un appel laisse son candidat retenu au brouillon

**Reproduit en base.** `private.close_call()` marque la proposition `DECLINED` et prévient l'agent que sa proposition n'a pas été retenue ; son affectation de révision 0 reste pourtant présente. Une publication ultérieure peut donc reprendre un agent qui a reçu le message inverse, ou rester bloquée parce que sa déclaration n'est plus recevable.

Preuve : `20261021090000_appels_remplacement.sql:950-987`, test `sql/appels.test.ts:164`. La fermeture par expiration utilise également cette fonction ; la reproduction exécutée porte sur l'annulation.

**Correction :** définir puis appliquer atomiquement le sort des affectations issues de l'appel à sa fermeture. Retirer uniquement celles que cette fermeture doit annuler, sans effacer une affectation indépendante. Tester annulation, expiration et publication du mois.

### A06 — P2 — Un agent désisté est sollicité pour reprendre la même garde

**Reproduit dans deux scénarios SQL.** Après acceptation simple puis retrait du brouillon, ou après annulation d'un premier appel, un nouvel appel peut solliciter l'agent dont le désistement a été accepté. `call_candidates()` exclut l'agent désigné par le désistement de l'appel courant, mais pas tous les désistements bloquants du créneau.

Preuve : `20261021090000_appels_remplacement.sql:735-770`, deux échecs de `sql/appels.test.ts`.

**Correction :** exclure les désistements pertinents à la candidature selon la même règle que celle utilisée à la publication ; couvrir aussi un second épisode de recherche sur la garde.

### A07 — P2 — Les inscriptions publiques Supabase sont encore ouvertes

**Constaté sur le service hébergé :** `/auth/v1/settings` renvoie `disable_signup: false`. L'absence de bouton d'inscription dans DispoSP ne ferme pas l'API d'inscription.

Cela ne donne pas automatiquement accès à un centre : le rattachement et les policies protègent les données. Cela ouvre néanmoins une création de comptes non invités et une surface d'abus du service d'authentification, contrairement au parcours annoncé.

**Correction :** désactiver les inscriptions libres si l'invitation est bien le seul mode d'entrée retenu, puis valider invitation, activation et récupération sur le projet de recette. Aucun compte public n'a été créé pour cet audit, et aucun réglage n'a été changé.

### A08 — P2 — La suite navigateur ne valide pas les parcours complets par rôle

**Constaté : 3 échecs, 8 tests ignorés en local connecté.** Le test des titres suppose que tout rôle accède à l'accueil agent, aux disponibilités et au planning personnel. Le compte fourni est ADMIN ; l'application le redirige légitimement. Le test responsive mesure parfois le document pendant cette redirection. Il faut corriger les tests, pas retirer la séparation des rôles.

Preuves : `tests/e2e/titres.spec.ts:24-41`, `tests/e2e/responsive.spec.ts:89-99`, `src/components/manager-page.ts:32-35`. La suite responsive omet `/appels`. En CI, 42 tests sont ignorés faute de base et d'identifiants : le vert ne signifie pas « parcours métier connecté validé ».

**Correction :** comptes de recette distincts AGENT/GESTIONNAIRE/ADMIN, attentes adaptées au rôle, attente de la destination finale avant mesures ; intégrer un scénario connecté de saisie → validation → publication → désistement → remplacement. Conserver les tests sans base pour la surface publique.

### A09 — P2 — Un appel expiré reste proposé à l'écran

**Reproduit par rendu du composant.** L'écran se fonde sur `state === "OPEN"`, sans comparer `expiresAt`. La base refuse correctement la candidature après échéance, mais l'interface garde « Je me propose » jusqu'à la fermeture par le traitement planifié et une relecture.

Preuves : `src/components/calls.tsx:70,164`, `src/components/shell.tsx:108-115`, `20261021090000_appels_remplacement.sql:1278-1307`. Les tâches fonctionnent actuellement, ce qui réduit le retard de fermeture en base ; un écran laissé ouvert peut conserver son état plus longtemps.

**Correction :** même définition d'un appel encore ouvert dans la liste, les badges, le panneau et les boutons ; transition d'affichage à l'échéance et contrôle serveur conservé.

### A10 — P2 — L'écran propose un appel alors que la base considère le besoin couvert

**Vérifié dans le code.** Un brouillon complet contenant un agent indisponible est jugé non publiable par l'écran. Le bouton de renfort apparaît, mais `private.kept_team()` compte encore cet agent ; l'aperçu peut dire « Besoin couvert » tout en laissant « Lancer l'appel » actif, puis la base refuse.

Preuves : `src/components/planning.tsx:465-467`, `src/components/calls.tsx:259-290`, `20261021090000_appels_remplacement.sql:679-690,885-887`.

**Correction :** désactiver la confirmation quand aucun manque n'est calculé et expliquer quel agent doit être retiré du brouillon. Ne pas modifier implicitement l'effectif conservé sans montrer les conséquences au gestionnaire.

### A11 — P2 / condition d'ouverture — L'information des agents et l'exploitation des droits restent à finaliser

`docs/RGPD.md` demeure un **document de travail à valider avec le DPO** : responsable, contact, base retenue et durées doivent être arrêtés. Aucun accès à une notice finalisée n'a été trouvé sur l'écran de connexion ou dans le gabarit d'invitation inspecté. Une diffusion par un autre canal reste possible et n'a pas été vérifiée.

La CNIL demande une information claire sur le traitement, notamment lors de la collecte directe. Le document interne ne suffit donc pas, à lui seul, à prouver que les agents sont informés. [Référence CNIL](https://www.cnil.fr/fr/informer-les-personnes).

**Écart technique précis :** l'export des données d'un compte restitue ses propositions, mais ne restitue pas ses sollicitations `call_recipients`. Ajouter ces données à l'inventaire et à l'export. Preuve : `supabase/provisioning/exporter-les-donnees-d-un-compte.sql:71-79`.

**Actions :** finaliser et distribuer la notice ; désigner le responsable de la purge mensuelle manuelle ; valider les contrats et régions réellement configurés avec les responsables compétents. Corriger aussi la documentation qui affirme que seul le choix de notifications est conservé localement : `src/components/auth.tsx:43-56,136` conserve facultativement l'adresse électronique sous `disposp.email`.

### A12 — P2 — Deux alertes de dépendances indirectes subsistent

| Dépendance                                | Avis du registre                                                               | Exposition examinée                                                                                                                        | Action                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `source-map-js` 1.2.1, via Next → PostCSS | Élevé, déni de service sur certaines source maps ; corrigé en 1.2.2            | Usage identifié dans la chaîne de construction ; aucun import de source map fournie par un utilisateur trouvé                              | Mettre à jour la résolution compatible, reconstruire et revérifier le verrouillage      |
| `uuid` 8.3.2, via ExcelJS                 | Modéré, contrôle de bornes absent dans certains générateurs avec tampon fourni | Les appels trouvés dans `exceljs/lib` utilisent `v4()` sans tampon ; le cas de l'avis n'est pas démontré comme atteignable par ces exports | Suivre le correctif de dépendance ; ne pas imposer aveuglément une majeure incompatible |

Sources : [avis source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [avis uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Le niveau du registre et l'exposition de DispoSP sont deux informations distinctes. Aucune exploitation n'a été tentée. Les anciens avis Next.js/Zod ne ressortent plus de l'audit de cette version.

### A13 — P2/P3 — Affichage et accessibilité : compléments ciblés

Le bandeau « Toujours au planning publié — le remplacement reste à faire » présente un contraste mesuré de **4,405:1**, inférieur à l'objectif de 4,5 utilisé par les tests du projet pour ce petit texte. Preuve : `src/app/globals.css:2883-2894`, contrôle navigateur complémentaire. Assombrir la couleur et ajouter ce bandeau aux tests de contraste.

Un débordement de **39 px** du planning à **768 px** a aussi été observé par le contrôle complémentaire, en dehors des redirections liées au rôle. Les mesures complètes et la cause sont précisées dans l'annexe d'affichage ci-dessous.

Les dialogues Radix, les libellés de formulaire, le lien d'évitement, les messages d'état et les titres constituent une bonne base. Les tests existants ne suffisent pas à conclure à une conformité d'accessibilité globale : ils vérifient une sélection de styles et de comportements, parfois sur du balisage injecté, et ne parcourent pas les nouveaux appels avec un compte agent.

## Sécurité et intégrité : acquis et réserves

**Acquis examinés :** identité relue côté serveur avec `getUser()`, validation Zod des commandes, droits et contrôles métier tenus en base, modules d'administration séparés des clients de session, protection d'origine des POST écrits à la main, secrets de traitement comparés en temps constant, liste de destinations push autorisées, jetons d'agenda aléatoires de 32 octets stockés sous forme de condensat, absence de cache métier dans le service worker, protection des cellules CSV contre les préfixes de formule, échappement des emails et formatage ICS testés.

Les tests complémentaires des appels et agendas confirment les cloisonnements sur les jeux locaux, les droits des fonctions privilégiées et la révocation d'accès aux tables privées. Les 40 fichiers SQL du répertoire sont bien ceux que charge le montage de test : aucune migration actuelle n'est oubliée par sa liste.

**Réserves à connaître :**

- La CSP autorise les scripts en ligne (`unsafe-inline`) ; elle protège notamment les destinations et les cadres, mais ne constitue pas une barrière complète contre une injection de script. Aucun chemin d'injection utilisateur exploitable n'a été identifié dans cette revue ; le `dangerouslySetInnerHTML` trouvé contient une règle d'impression constante.
- Les écritures en lot de besoins sont atomiques par créneau, pas pour tout le lot. Une panne au milieu laisse les créneaux précédents enregistrés. La saisie de disponibilités utilise aussi une mise à jour puis une insertion distinctes. L'écran se relit après un échec ; ne pas promettre une annulation globale du lot. Prévoir un test de reprise réseau et, si nécessaire, un résultat détaillé ou une transaction de lot.
- Les mécanismes de verrouillage de repos sont présents et testés pour l'acquisition du verrou. La concurrence réelle entre deux connexions reste à vérifier dans une base de recette PostgreSQL.
- Le repos au changement d'heure utilise une durée réelle, pas nécessairement 12 h/24 h nominales. C'est un choix métier à confirmer, sans effet particulier sur le lancement de novembre 2026 aux horaires 8 h/20 h.
- Un nom de campagne n'a pas de longueur maximale dans la commande (`domain.ts:749`) ; une garde de nuit commencée la veille sort de la liste « à venir » à minuit (`my-planning.tsx:53`). À borner et clarifier, sans en faire des blocages généraux du lancement.

## Performance, fiabilité et exploitation

La pagination tient compte des plafonds Supabase, l'ordre des lignes est stable et la synthèse est virtualisée. Cela protège contre les réponses tronquées et limite le nombre de lignes rendues. En revanche, le layout charge un état commun portant sur **12 mois** ; les destinataires et propositions d'appels sont lus sur l'ensemble du centre avant filtrage du modèle.

À titre de dimensionnement, 300 agents × 31 jours × 12 mois représentent jusqu'à **111 600 lignes de disponibilités**, soit environ 224 pages de 500 lignes pour cette seule table. Ce calcul est une borne indicative, pas un temps de réponse mesuré. La virtualisation de l'écran ne réduit pas ces lectures réseau. Avant extension importante, tester une copie représentative et mesurer latence, volume transféré et coût des relectures ; envisager des chargements par écran et par campagne.

La file d'emails possède des baux, une clé d'idempotence et des pauses sur les refus du fournisseur ; les push ont des délais et des reprises bornées. Le traitement planifié est observable depuis les paramètres. Il manque toutefois une preuve, dans ce périmètre, qu'une personne sera alertée lorsque ces passages s'arrêtent ou qu'une livraison échoue durablement. L'écran Paramètres ne suffit pas si personne ne l'ouvre.

À préparer avant l'ouverture : une alerte de disponibilité et d'absence de passages planifiés, un responsable joignable, la procédure de restauration déjà demandée dans `docs/RECETTE.md:425-431`, le retour à la version applicative précédente et une règle de compatibilité avec les migrations. Aucun retour arrière de base ne doit être improvisé en supprimant des migrations déjà appliquées.

Les réglages SMTP, les quotas et l'arrivée réelle des messages sont à valider séparément : une file vide et un statut d'exécution réussi ne prouvent ni réception en boîte principale, ni push reçu sur un téléphone fermé, ni rafraîchissement d'un agenda abonné. Les contrôles recommandés par Supabase couvrent également les accès techniques et la continuité de service. [Checklist de production Supabase](https://supabase.com/docs/guides/deployment/going-into-prod).

## Plan jusqu'à l'ouverture

| Quand                      | Travail                                                                                               | Critère de sortie                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 28 octobre                 | Corriger A01/A02, puis A05/A06/A09/A10 dans le même parcours de remplacement                          | Les contre-épreuves deviennent vertes ; scénario complet avec un agent arrivé après clôture |
| 29 octobre                 | Conditionner la production aux tests, fermer l'inscription libre, traiter les dépendances compatibles | Promotion contrôlée ; invitation conservée fonctionnelle ; nouvel audit des dépendances     |
| 29–30 octobre              | Corriger les tests par rôle et l'affichage ; recette sur environnement séparé                         | Tests AGENT/GESTIONNAIRE/ADMIN et vrais échanges publication/remplacement                   |
| Avant le 31 octobre        | Choisir et préparer la première campagne ; valider la notice et les responsables d'exploitation       | Mois et échéance visibles et compris ; information des agents prête                         |
| Avant ouverture            | Restaurer une sauvegarde, vérifier SMTP/push/agenda, préparer alerte et retour arrière                | Preuves datées et personne désignée pour chaque incident                                    |
| Premiers jours de novembre | Ouverture accompagnée, contrôle des premières réponses et publications                                | Vérification quotidienne des erreurs, files d'envoi et écarts métier                        |

Les dates proposées organisent les priorités ; elles ne constituent pas une estimation garantie de charge. Si la correction et la recette du remplacement ne sont pas achevées, ne pas présenter ce parcours comme prêt : conserver explicitement la procédure opérationnelle existante jusqu'à sa validation.

## Preuves et reproductibilité

- `tests-paris-hote.log` : suite officielle 608/608.
- `ci.log` : copie du journal du travail GitHub du commit, comprenant 608 tests, 299 en UTC, construction et 62 parcours publics réussis.
- `e2e.log` : 104 cas navigateur connectés, dont 93 réussites, 3 échecs et 8 ignorés.
- `reproductions.log` : reprise des contre-épreuves existantes sur le commit actuel, 18 tests, 4 échecs métier et 14 réussites.
- `complements.log` : contexte de campagne du nouvel agent, rendu des horaires, expiration et catalogue de sécurité, 6 tests, 3 échecs métier et 3 réussites.
- `dependances-hote.json`, `hebergement.json`, `deploiement.json` : résultats des lectures datées.
- `build-webpack.log`, `lint.log`, `types.log`, `format.log` : vérifications locales.
- `rendu.log`, `rendu-complet.log`, `mesures-ecrans.json` : vérifications d'affichage complémentaires, distinctes de la suite officielle.

Les contre-épreuves volontairement rouges restent séparées de `tests/` et de la CI habituelle. Elles expriment le résultat attendu après correction ; leur échec constitue la preuve de l'écart actuel, pas une régression introduite par cet audit.

## Annexe — mesures d'affichage complémentaires

Après stabilisation des polices et de la navigation, **12 écrans administrateur × 4 largeurs = 48 mesures** ont été réalisées : 320, 390, 768 et 1 440 px. Écrans : tableau de bord, disponibilités, planning, besoins, désistements, agents, campagnes, statistiques, historique, notifications, paramètres et profil. Le jeu hébergé est peu peuplé ; ces mesures ne couvrent pas tous les états métier ni les modales.

**47 mesures sur 48 ne présentent aucun débordement horizontal global.** L'exception est le planning à 768 px : le bouton `.month-publish` mesure 139 px et son bord droit atteint 807 px. La capture a été examinée : la barre latérale reste visible, le libellé des horaires se comprime verticalement et le bouton sort du panneau. La règle permettant à `.planning-toolbar` de revenir à la ligne ne s'applique qu'à 760 px et moins (`globals.css:4062`, dans le bloc ouvert à `:3781`) ; la barre de base est définie à `:1785`.

**Correction proposée :** permettre le retour à la ligne de cette barre dès que sa largeur utile l'exige, ou ajuster le seuil tenant compte de la barre latérale ; ne pas masquer simplement le débordement. Vérifier notamment 760, 768, 820 et 1 024 px avec le bouton de publication du mois présent.

Le temps observé jusqu'au premier octet est compris entre **435 et 726 ms**, moyenne **554 ms**, sur ces navigations locales vers la base distante. Il ne s'agit ni d'un percentile sous charge ni d'une mesure des performances de Vercel ou du réseau mobile ; ces chiffres ne justifient aucune promesse de capacité.

La capture contenant le nom du compte connecté reste dans `.local/` et n'est pas incluse dans l'archive partageable. Les mesures, classes CSS et journaux suffisent à reproduire le défaut sans diffuser cette identité.
