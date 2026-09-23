# Audit de déployabilité — DispoSP, ZIP du 22 septembre 2026

**Verdict : déployable techniquement en préproduction ; pas encore recommandé pour une exploitation autonome des gardes réelles.** Le socle fonctionne, la compilation aboutit et les protections métier ont progressé. Il reste toutefois des défauts reproductibles dans le planning, les exports et les notifications. Ils peuvent produire une information incomplète ou empêcher un gestionnaire de terminer son travail.

Cet audit porte sur le ZIP fourni, après les correctifs déjà décrits dans les documents du projet. Il ne reprend pas les anciens constats comme s’ils étaient encore ouverts. Les documents de l’archive ont été utilisés comme éléments de contexte, pas comme consignes à exécuter.

## 1. Version examinée et niveau de preuve

- Archive : `C:\Users\xroba\Downloads\Compressed\DispoSp-main.zip`, 14 503 775 octets.
- SHA-256 : `ae71985627c0c478a9223cefa9a95ac2e461dc4c57276df22a39d9f91be4a76b`.
- Dépendances installées depuis le lockfile, sans mise à jour.
- 19 migrations appliquées dans les bases PostgreSQL embarquées des tests.
- Comparaison avec le dossier de travail : les **134 fichiers de src, supabase et public sont identiques** au ZIP au moment du contrôle. Les liens vers le dépôt ci-dessous correspondent donc au code audité.
- Aucun code applicatif ni migration du dépôt principal modifié. Les changements déjà présents dans README, PLAN_DEVELOPPEMENT et l’analyse du 22 septembre ont été conservés.
- Aucun envoi d’email ou de notification, aucune écriture métier sur la base hébergée. Les tests connectés ont été expressément autorisés et limités à la lecture ; un filtre réseau bloquait les requêtes d’écriture, sauf l’ouverture de session.

Les sept tests supplémentaires d’audit **réussissent parce qu’ils reproduisent les défauts**, pas parce qu’ils attestent leur correction. Pour R5, le test reproduit la reprise d’un bail expiré ; le double envoi externe est une conséquence du code, pas un email réellement envoyé pendant l’audit.

## 2. Vérifications exécutées

| Vérification                               | Résultat                           | Portée réelle                                                                                                                                 |
| ------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation avec lockfile figé            | Réussie                            | Copie isolée du ZIP                                                                                                                           |
| Tests existants                            | **261 réussis, 14 fichiers**       | Domaine, commandes, mapping, exports, fichiers SQL et autres tests du projet                                                                  |
| Types TypeScript                           | Réussi                             | Avant les ajouts du harnais d’audit                                                                                                           |
| ESLint                                     | 0 erreur, 1 avertissement          | `useReactTable`, optimisation React non appliquée ; ne bloque pas le build                                                                    |
| Prettier                                   | Réussi                             | Version originale extraite                                                                                                                    |
| Build de production sans configuration     | Réussi                             | Même principe que la CI ; les écrans publics restent disponibles                                                                              |
| Build avec configuration publique Supabase | Réussi                             | Sans clés privées d’envoi dans le processus d’audit                                                                                           |
| E2E existants sans compte                  | **10 réussis, 24 sautés**          | Surface publique ; ce résultat ne valide pas les parcours métier connectés                                                                    |
| Parcours connectés dédiés                  | **2 réussis**                      | Chromium ordinateur et mobile, navigation vers 15 routes, largeur 320 / 768 / 1 440 px, ouverture des formulaires accessibles sans validation |
| Reproductions complémentaires              | **7 réussies**                     | 6 tests SQL/export et 1 rendu du planning sur données fictives                                                                                |
| Audit des dépendances                      | 1 alerte modérée, 0 haute/critique | Dépendance transitive `exceljs > uuid@8.3.2`                                                                                                  |
| Adresse publique                           | 4 réponses HTTP 200                | Connexion, manifeste, service worker et page hors ligne sur `https://dispo-sp.vercel.app`                                                     |

Les contrôles publics ont constaté HTTPS, HSTS et l’interdiction d’intégration en iframe. Le service worker porte une politique de cache adaptée. Cela ne prouve ni que le déploiement public correspond au ZIP, ni que ses variables privées et migrations sont toutes correctes.

Le contrôle responsive n’a pas détecté de débordement horizontal dans les écrans accessibles au compte d’essai. Il ne constitue pas une validation sur un véritable iPhone/Safari, ni une certification d’accessibilité. Les tests n’ont demandé aucune permission de notification.

## 3. Défauts à traiter avant une utilisation opérationnelle

### R1 — P1 — Réenregistrer un téléphone efface ses notifications en attente

**Confirmé en base fictive.** Le même compte enregistre un abonnement, une notification crée un envoi en attente, puis le compte enregistre à nouveau exactement le même abonnement : la file passe de **1 envoi à 0**, tandis que la notification interne subsiste.

La fonction [register_push_subscription](E:/GitHub/DispoSp/supabase/migrations/20260921130000_web_push_abonnement.sql:24) supprime toujours l’abonnement avant de le recréer. La clé étrangère de [push_deliveries](E:/GitHub/DispoSp/supabase/migrations/20260921100156_web_push_notifications.sql:33) efface les envois en cascade. Le [composant mobile](E:/GitHub/DispoSp/src/components/pwa.tsx:211) effectue ce réenregistrement à son montage ; le parcours normal du profil ou du centre de notifications suffit donc à exposer le problème.

**Correction :** rendre l’enregistrement idempotent pour le même propriétaire et le même appareil, en conservant l’identifiant d’abonnement et les envois. Traiter séparément le changement de propriétaire. Tester un réabonnement avec des envois pending et sending.

### R7 — P1 — Un agent désactivé peut bloquer un planning sans être retirable à l’écran

**Confirmé par rendu sur données fictives.** Une affectation à un agent devenu inactif reste dans le brouillon. Le calcul de couverture la signale correctement comme invalide, mais la liste des cartes se limite aux agents actifs dans [Planning](E:/GitHub/DispoSp/src/components/planning.tsx:66). La carte et son bouton « Retirer » disparaissent. Le [bouton de publication](E:/GitHub/DispoSp/src/components/planning.tsx:357) reste désactivé.

Le correctif récent sur `coverage()` protège la publication, mais ne donne pas encore à l’utilisateur le moyen de réparer le brouillon. Réactiver artificiellement le compte ou intervenir en SQL serait un contournement.

**Correction :** afficher aussi les agents inactifs déjà affectés, clairement signalés et retirable ; les garder exclus des candidats à une nouvelle affectation. Test attendu : désactiver, retirer du brouillon, remplacer, publier.

### R2 — P1 — Un agent retiré d’une republication n’est pas averti

**Confirmé en base fictive.** Publication avec A et B, retrait de A du brouillon, republication avec B seul et effectif suffisant : A disparaît bien de la nouvelle version, mais ne reçoit aucune nouvelle notification.

La [fonction de publication](E:/GitHub/DispoSp/supabase/migrations/20260921140000_verrou_publication.sql:108) ne notifie que les agents de la nouvelle révision. Une suppression d’affectation ne produit donc ni message interne, ni email, ni push pour la personne retirée. Le message de publication précédent peut rester sa dernière information.

**Correction :** comparer les deux versions et prévenir aussi les agents retirés, en précisant la campagne, la date et le créneau dans le message interne. Garder un texte discret sur l’écran verrouillé. Le scénario reproduit ici est un retrait décidé par le gestionnaire, pas un désistement déjà notifié.

### R3 — P1 — L’export Excel peut omettre une garde encore publiée

**Confirmé avec le générateur réel de classeur.** Une garde publiée contient Julien. Le gestionnaire prépare son remplacement par Marie dans le brouillon, sans republier. L’onglet Affectations n’exporte plus Julien, alors que sa garde est toujours officielle.

La [boucle d’export](E:/GitHub/DispoSp/src/lib/workbook.ts:152) ne parcourt que les affectations du brouillon et utilise ensuite la publication comme une étiquette. Elle ne représente pas les deux ensembles. La recherche du nom dans les seuls agents actifs omet également un agent désactivé encore présent dans une version publiée.

**Correction :** exporter séparément brouillon et version publiée, ou exporter leur union avec deux statuts explicites. Conserver le nom des agents inactifs concernés. Test attendu : le remplacement préparé ne fait jamais disparaître la version encore publiée de l’export.

### R4 — P1 lors d’un transfert — L’ancien centre peut encore modifier le profil global d’un agent

**Confirmé en base fictive sous le rôle authenticated.** A désactive un agent ; l’agent obtient ensuite un rattachement actif en B. Le gestionnaire de A peut toujours modifier son nom global, et le compte actif de l’agent voit cette modification.

La [policy de profil](E:/GitHub/DispoSp/supabase/migrations/20260922100000_reactivation_administrateur_devalidation.sql:50) considère les rattachements inactifs pour permettre leur réactivation. Or `profiles` appartient à la personne, pas au centre. La règle « un seul centre actif » n’empêche pas l’ancien centre de garder ce droit. Le même raisonnement concerne la lecture des coordonnées actualisées.

**Correction :** distinguer les données de la personne et celles du rattachement, ou retirer le droit de modification de l’ancien centre lorsqu’un rattachement actif existe ailleurs. Garder la réactivation possible lorsque la personne n’est active dans aucun autre centre. Ce point est particulièrement important avant d’héberger plusieurs centres ou d’autoriser les transferts.

### R8 — P1 pour un usage partagé — Changer d’écran ne garantit pas une relecture des données

**Constat architectural établi par le code et la documentation de la version installée ; scénario avec modification distante non joué sur la base réelle.** L’état complet est chargé dans le [layout partagé](<E:/GitHub/DispoSp/src/app/(workspace)/layout.tsx:29>). Les pages comme Planning et Notifications rendent ensuite leur composant sans relire cet état. Les rafraîchissements explicites se trouvent essentiellement après les [commandes du visiteur](E:/GitHub/DispoSp/src/components/provider.tsx:122).

Les layouts Next sont conservés lors des navigations internes. La promesse du README « relu à chaque navigation » n’est donc pas tenue par cette architecture : un agent resté dans l’application peut naviguer vers son planning et garder l’état antérieur à la publication d’un gestionnaire. Un rechargement complet relit bien les données. Le fonctionnement des layouts est documenté par [Next.js](https://nextjs.org/docs/app/getting-started/layouts-and-pages).

**Correction :** définir et implémenter une politique de fraîcheur : relecture ciblée par page, rafraîchissement au retour au premier plan, signal de changement, ou combinaison adaptée. Ajouter une recette à deux sessions : publication dans la première, navigation interne dans la seconde, affichage de la nouvelle version sans rechargement manuel.

## 4. Fiabilité des envois et exploitation

### R5 — P2 — Le bail email peut expirer avant la fin de son propre lot

Le [worker email](E:/GitHub/DispoSp/src/lib/mailer.server.ts:7) réserve 50 messages et les envoie séquentiellement avec jusqu’à 10 secondes d’attente par message. Le [bail SQL](E:/GitHub/DispoSp/supabase/migrations/20260922150000_rattachement_retrait_file_email.sql:142) dure deux minutes. Un lot lent peut donc durer jusqu’à environ 500 secondes, hors échanges avec la base.

La reproduction confirme qu’une réservation expirée est reprise avec un nouveau jeton et que l’ancien jeton ne peut plus enregistrer le résultat. Mais l’ancien worker ne vérifie pas ce jeton avant l’envoi : il peut encore contacter Resend avec sa copie du message. Le [POST Resend](E:/GitHub/DispoSp/src/lib/mailer.server.ts:30) n’utilise pas de clé d’idempotence. Une réponse réseau perdue après acceptation présente aussi un risque de doublon à la reprise.

**Correction :** lots bornés par un budget de temps, bail cohérent ou renouvelé, et clé d’idempotence stable par notification. Resend propose précisément des [clés d’idempotence](https://resend.com/docs/dashboard/emails/idempotency-keys). `after()` demeure soumis à la durée maximale de l’hébergement, il ne constitue pas un worker permanent : [documentation Next.js](https://nextjs.org/docs/app/api-reference/functions/after).

### R9 — P1 si les notifications sont annoncées fiables — Le rattrapage email dépend encore d’un prochain utilisateur

Dans le ZIP, les deux files sont traitées après une commande réussie. Un échec temporaire est reporté dans le futur. Si personne ne fait ensuite de commande, aucun traitement ne réveille la file email. La [route de planification](E:/GitHub/DispoSp/src/app/api/push/dispatch/route.ts:7) ne traite que les pushes, même si un planificateur externe l’appelle.

Le README indique qu’aucun planificateur n’est configuré ; cette affirmation documentaire n’a pas été vérifiée dans le tableau de bord de l’hébergeur. Le problème du point d’entrée email, lui, est présent dans le code. Les deux files sont aussi traitées successivement dans [actions.ts](E:/GitHub/DispoSp/src/app/actions.ts:36), ce qui laisse les emails attendre le traitement push.

**Correction :** un déclenchement périodique authentifié couvrant les deux canaux, avec traitement borné, métriques d’attente et alerte sur les échecs définitifs. Vérifier qu’un message retardé repart sans aucune visite sur le site. Le choix Supabase Cron / QStash / autre planificateur peut venir après cette garantie.

### R6 — P2 — Les emails déjà en attente partent encore vers un membre désactivé

**Confirmé en base fictive.** Une notification est créée, son destinataire est désactivé, puis `claim_email_deliveries()` réserve toujours son email. La [sélection](E:/GitHub/DispoSp/supabase/migrations/20260922150000_rattachement_retrait_file_email.sql:130) vérifie l’existence d’une adresse, sans vérifier que le rattachement reste actif. La file push, elle, possède ce contrôle.

Cela concerne surtout un ancien gestionnaire qui aurait encore des messages détaillant des désistements dans la file. La décision d’envoyer ou de supprimer ces messages après un départ doit être explicite.

**Correction :** supprimer logiquement les envois devenus non autorisés et appliquer une durée de validité aux messages devenus obsolètes. Tester une désactivation entre création et réservation.

### R10 — P2 — Le cycle de vie de l’abonnement ne respecte pas entièrement le choix par compte

Le [hook mobile](E:/GitHub/DispoSp/src/components/pwa.tsx:211) affiche « Actives » dès qu’un abonnement navigateur existe, puis le rattache automatiquement au compte courant, sans tenir compte de son choix mémorisé et sans vérifier le résultat booléen du réenregistrement. Le [logout](E:/GitHub/DispoSp/src/app/deconnexion/route.ts:10) ne retire pas l’abonnement serveur.

Sur un appareil partagé, l’accord donné par A peut donc devenir un abonnement pour B dès sa connexion, alors que B n’a rien accepté pour son compte. Une erreur de réenregistrement peut aussi laisser un affichage actif alors que le serveur ne connaît pas l’appareil.

**Correction :** distinguer permission du navigateur, abonnement technique et accord du compte ; n’annoncer l’état actif qu’après confirmation serveur. Définir le comportement de déconnexion et de changement de compte. Tester A accepte, A se déconnecte, B refuse, B ne reçoit rien.

## 5. Autres points à prévoir

| Point                                             | Impact et recommandation                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 50 notifications seulement, mais « Tout est lu »  | La lecture est limitée à 50 dans `data.server.ts:106`, sans avertissement équivalent dans `notifications.tsx:31`. Des messages plus anciens non lus peuvent rester invisibles. Ajouter pagination et compteur réel, ou annoncer explicitement la limite.                                                                    |
| Tout l’historique chargé avec l’espace de travail | La pagination corrige la troncature, mais disponibilités, campagnes et toutes les révisions d’affectation restent chargées ensemble. Le volume croît avec les mois. Charger prioritairement la campagne demandée et mesurer avec plusieurs années de données. Les essais présents ne sont pas un test de charge.            |
| Fuseau de l’interface                             | `localDate()` utilise le fuseau du navigateur, alors que la base applique Europe/Paris. Un agent à l’étranger peut voir un état de clôture différent autour de minuit. Uniformiser le calcul des dates de référence ; la base reste la décision finale.                                                                     |
| Concurrence entre administrateurs                 | Le contrôle du dernier administrateur compte les lignes mais ne sérialise pas les retraits à l’échelle du centre. Deux administrateurs se désactivant mutuellement méritent un test sur deux connexions PostgreSQL. Risque identifié à la lecture, non reproduit ici ; PGlite ne remplace pas cette recette de concurrence. |
| Écritures en plusieurs appels                     | L’édition complète d’un membre et l’application des besoins à plusieurs créneaux peuvent rester partiellement appliquées. La garantie par créneau est correctement documentée. Pour la fiche agent, une transaction unique améliorerait la cohérence des qualifications et du rôle.                                         |
| Essai push sans quota applicatif                  | La route d’essai envoie vers tous les appareils du compte, pas seulement le téléphone courant, sans temporisation par compte. Ajouter une limite et préciser la portée du bouton.                                                                                                                                           |
| Avertissements de maintenance                     | Convention `middleware` dépréciée par Next ; avertissement React/TanStack sans erreur. À traiter dans la maintenance, pas comme blocages immédiats.                                                                                                                                                                         |
| Documentation                                     | Plusieurs descriptions de fraîcheur, d’absence de données conservées dans le navigateur et de statut de déploiement sont trop absolues. La session et l’adresse mémorisée existent aussi côté navigateur. Réécrire les garanties après les corrections et distinguer code livré, migration appliquée et recette réussie.    |

L’alerte `uuid` est [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), sur certaines fonctions v3/v5/v6 avec tampon fourni. Dans le code ExcelJS installé examiné, l’import identifié utilise v4 sans ce tampon. Aucun chemin exploitable n’a été établi ici ; traiter la dépendance sans imposer aveuglément une nouvelle version majeure transitive.

## 6. Ce qui est déjà solide

- Les écritures métier ordinaires utilisent l’identité de l’utilisateur et les politiques RLS. Les clients privilégiés restent côté serveur et servent aux opérations explicitement prévues.
- Les tests appliquent les migrations SQL réelles. Les frontières de rôles, l’isolation courante entre centres et les refus métier sont bien mieux protégés qu’avec des contrôles uniquement dans l’interface. La combinaison droits SQL + RLS suit le modèle documenté par [Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Création de campagne, application de modèle et écriture complète des besoins d’un créneau disposent de transactions.
- La validation explicite, les jours non renseignés, les disponibilités 24 h et la distinction potentiel / planifié sont représentés dans le domaine et testés.
- La publication vérifie disponibilités validées, effectif, qualifications, membres actifs et désistements acceptés. Les révisions publiées sont séparées du brouillon.
- Les erreurs de lecture ne sont plus silencieusement transformées en tableaux vides.
- Le push n’envoie pas de nom ou motif sur l’écran verrouillé ; les destinations de livraison sont contrôlées.
- L’application possède manifeste, écran hors ligne, chargements visibles, messages d’erreur et une base responsive convaincante dans les dimensions mesurées.

## 7. Conditions de feu vert

**Pour une préproduction : oui dès maintenant**, avec comptes d’essai, données non opérationnelles et suivi des constats.

**Pour un pilote utilisant de vraies gardes :** corriger R1, R7, R2, R3 et la fraîcheur R8 ; régler la reprise autonome R9 si les notifications sont présentées comme un service disponible. Corriger R4 avant tout transfert entre centres. Valider les scénarios corrigés et informer précisément des canaux effectivement actifs.

**Avant généralisation :** vérifier sur l’hébergement les 19 migrations attendues, les variables du build et du serveur, les URL d’activation/récupération et le domaine expéditeur ; effectuer une invitation complète avec accord, une réception réelle Android et iPhone installé, une reprise d’envoi après panne, une recette à plusieurs rôles et un exercice de restauration. Définir la conservation des données et qui prend en charge les incidents.

Ces derniers éléments ne sont pas déclarés défaillants : ils ne sont simplement pas prouvés par un ZIP, un build ou une visite HTTP. Les variables nécessaires sont présentes dans le fichier local inspecté, ce qui ne démontre pas leur présence chez l’hébergeur. Aucun test de livraison réelle ou de restauration n’a été exécuté.

**Ordre conseillé :** réparer la cohérence planning/export, sécuriser le cycle push et le rattrapage des deux canaux, régler fraîcheur et transfert de profils, puis effectuer la recette de mise en service. Il n’est pas nécessaire de réécrire le projet.

## 8. Preuves locales

Les preuves ont été rangées hors du dépôt pour que la copie auditée ne soit pas incluse dans le TypeScript du projet principal. Le dossier temporaire peut être supprimé ultérieurement sans effet sur le projet.

- [Résultat des 261 tests](C:/Users/xroba/AppData/Local/Temp/disposp-audit-zip-20260922/tests.log)
- [Build sans configuration](C:/Users/xroba/AppData/Local/Temp/disposp-audit-zip-20260922/build.log)
- [Build connecté](C:/Users/xroba/AppData/Local/Temp/disposp-audit-zip-20260922/build-connected.log)
- [E2E publics](C:/Users/xroba/AppData/Local/Temp/disposp-audit-zip-20260922/e2e.log)
- [Parcours connectés sans écriture](C:/Users/xroba/AppData/Local/Temp/disposp-audit-zip-20260922/e2e-connected.log)
- [Reproductions SQL et Excel](C:/Users/xroba/AppData/Local/Temp/disposp-audit-zip-20260922/DispoSp-main/tests/audit-zip-findings.test.ts)
- [Reproduction du planning avec agent inactif](C:/Users/xroba/AppData/Local/Temp/disposp-audit-zip-20260922/DispoSp-main/tests/audit-zip-ui.test.ts)
- [Harnais navigateur avec blocage des écritures](C:/Users/xroba/AppData/Local/Temp/disposp-audit-zip-20260922/DispoSp-main/tests/e2e/audit-readonly.spec.ts)

Pour rejouer les preuves, repartir du ZIP avec ses dépendances verrouillées et recopier les tests d’audit dans la copie de travail correspondante. Les dépendances de la copie temporaire déplacée ne sont pas garanties réutilisables telles quelles sous Windows. Les preuves ne doivent pas être confondues avec une nouvelle suite de régression destinée à être fusionnée : leurs assertions décrivent les défauts constatés.
