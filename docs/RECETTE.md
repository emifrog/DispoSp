# Recette avant mise en service — DispoSP

Cette liste se parcourt **sur l'adresse publique**, pas en local. Elle sert à vérifier ce qu'aucun test automatique ne peut atteindre : la configuration de l'hébergement, l'arrivée réelle des emails, et le parcours de bout en bout avec de vraies personnes.

Chaque étape dit ce qu'on fait, ce qu'on doit voir, et quoi conclure si on voit autre chose. **Une étape qui échoue arrête la recette** : les suivantes en dépendent.

## Avant de commencer

**Il faut** : deux comptes de messagerie distincts (un administrateur, un agent) et un téléphone — la partie 8, qui vérifie l'installation et les notifications poussées, ne peut pas se faire autrement. Comptez une demi-journée d'attention, étalée sur deux ou trois jours — l'essentiel du délai vient de la vérification du domaine d'expédition et de l'attente des emails.

**Choisissez un mois qui ne sert pas encore.** La recette crée une vraie campagne avec de vraies données : ne la faites pas sur le mois en cours.

**Notez au fur et à mesure.** Un tableau vide est fourni à la fin.

---

## Partie 0 — La configuration

C'est la partie la plus importante, et celle qu'on saute le plus volontiers.

### 0.1 Le site public affiche-t-il les vraies données ?

**Faire** — Ouvrir l'adresse publique dans une fenêtre de navigation privée.

**Attendu** — Un écran de connexion. Rien d'autre.

**Sinon** — Si l'écran affiche une erreur, les coordonnées Supabase manquent sur l'hébergeur : `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. L'application s'arrête plutôt que de se rabattre sur quoi que ce soit — il n'existe plus de mode démonstration, donc plus de risque qu'un responsable planifie un mois entier sur des agents fictifs sans s'en apercevoir.

### 0.2 Les adresses de retour d'authentification

**Faire** — Dans Supabase, Authentication → URL Configuration, vérifier que l'adresse publique figure en Site URL et dans les Redirect URLs.

**Attendu** — L'adresse exacte du site, avec `https://`.

**Sinon** — Les liens d'activation renverront vers `localhost` ou vers une page d'erreur. L'agent ne pourra jamais activer son compte. Ça ne se verra qu'à l'étape 1.2, trop tard pour lui.

### 0.3 L'expéditeur des emails

**Faire** — Vérifier les trois variables sur l'hébergeur : `RESEND_API_KEY`, `RESEND_FROM`, `APP_URL`. Dans Resend, vérifier que le domaine d'expédition est validé (SPF et DKIM).

**Attendu** — Les trois présentes, le domaine au vert chez Resend.

**Sinon** — Sans ces trois variables, **aucun email métier ne part**. L'application continue de fonctionner : les notifications s'affichent dans son centre de messages et la file d'attente se garde. Mais personne n'est prévenu de rien, et une application de disponibilités dont on n'est pas prévenu est une application qu'on oublie.

Un domaine non validé donne pire : les messages partent et atterrissent en indésirables.

**Deux expéditeurs, à ne pas confondre.** Resend porte les messages métier — ouverture de campagne, rappel, publication, désistement. **Supabase Auth** porte l'activation d'un compte et la réinitialisation d'un mot de passe, avec son propre expéditeur et ses propres gabarits. Un domaine Resend parfait ne fera pas arriver un message d'activation.

### 0.4 Les invitations et leurs gabarits

**Faire** — Vérifier `SUPABASE_SECRET_KEY` sur l'hébergeur. Dans Supabase, Authentication → Email Templates, régler les deux liens :

| Gabarit          | Lien                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| `Invite user`    | `{{ .SiteURL }}/auth/activation?token_hash={{ .TokenHash }}&type=invite`     |
| `Reset password` | `{{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&type=recovery` |

**Attendu** — La clé présente, les deux gabarits modifiés.

**Attendu, dans le message reçu** — Un lien qui commence par l'adresse publique et contient `/auth/activation?token_hash=`.

**Sinon** — Sans la clé, aucune invitation ne part : la ligne est enregistrée et l'écran le dit, mais aucun agent ne peut entrer. Sans les gabarits, les liens ne fonctionnent que sur l'appareil qui a fait la demande — ce qui condamne l'activation, toujours demandée par une personne et ouverte par une autre.

**Le symptôme, quand ces deux réglages manquent** : l'agent reçoit le message anglais d'origine, « You've been invited », dont le lien mène à `SiteURL` suivi d'un `#`. Si Site URL est resté sur `http://localhost:3000`, le téléphone affiche « Ce site est inaccessible » — il cherche un serveur sur le téléphone lui-même. Et même une fois Site URL corrigée, ce lien-là dépose son jeton **après le `#`**, où aucun serveur ne le lit : l'agent retomberait sur l'écran de connexion sans avoir choisi de mot de passe. Les deux réglages vont ensemble.

**Les invitations déjà envoyées gardent le lien d'origine.** Après correction, les renvoyer depuis **Agents & équipes → Invitations en attente → Renvoyer**.

### 0.5 Le centre sur lequel se fait la recette

**Faire** — Vérifier que le centre affiché en haut de l'application est le vrai centre, et non un centre d'essai. Le nom d'un centre ne se change depuis aucun écran : la bascule se fait par `supabase/provisioning/inventaire-du-centre.sql`, qui montre ce que contient le centre d'essai, puis `basculer-vers-un-vrai-centre.sql`, qui crée le vrai et **efface l'autre**. Le README détaille les trois étapes.

**Attendu** — Le vrai nom, une section, les horaires du centre, et les comptes qui doivent y être rattachés — **y compris celui de la recette** (`E2E_EMAIL`), sans quoi les parcours navigateur qui demandent une session se sautent.

**Sinon** — Faire la recette sur un centre d'essai la vide de son sens : les emails partent à des adresses fictives, et les plannings produits ne servent à personne. Une fois la bascule faite, ouvrir la première campagne avec `premiere-campagne.sql`, sans quoi tous les écrans affichent celui qui l'explique.

### 0.6 Les notifications poussées

**Faire** — Vérifier que les deux migrations `20260921100156_web_push_notifications.sql` et `20260921130000_web_push_abonnement.sql` sont bien passées sur **le projet Supabase du site public** — elles le sont sur celui de développement. La table `public.push_subscriptions` doit exister. Puis vérifier sur l'hébergeur `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` et `WEB_PUSH_SUBJECT`, en plus de `SUPABASE_SECRET_KEY` déjà vérifiée à l'étape précédente.

**Attendu** — La table est là ; les trois variables sont présentes. **Après toute modification de `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, reconstruire et redéployer** : une variable publique est figée dans le paquet au moment de la construction.

**Sinon** — Sans les migrations, l'activation échouera sur le téléphone de l'agent. Sans les variables, l'écran n'offre pas l'activation du tout : les notifications restent dans le centre de messages et dans les emails, ce qui est le comportement voulu, mais la partie 8 n'a alors plus d'objet.

**À ne pas faire** — Régénérer la paire de clés une fois des agents abonnés. Changer la clé publique **invalide tous les abonnements existants** : chaque téléphone devient muet sans que personne le remarque, et chaque agent doit réactiver. Gardez la paire avec les autres secrets du projet.

---

## Partie 1 — L'arrivée d'un agent

Si cette partie échoue, rien d'autre ne sert : personne n'entre.

### 1.1 Enregistrer une invitation

**Faire** — Connecté en administrateur, écran **Agents & équipes**, bouton **Inviter un agent**. Saisir l'adresse du second compte, son grade, sa fonction et le rôle _Agent_, puis **Envoyer l'invitation**.

**L'équipe ne se demande plus** : l'invité rejoint celle de l'invitant, et la boîte le dit. Pour l'affecter ailleurs, ouvrir sa fiche une fois le compte activé.

**Attendu** — L'invitation apparaît dans « Invitations en attente », avec **Renvoyer** et **Annuler**.

**Sinon** — Le message « L'invitation est enregistrée, mais le message n'a pas pu partir » signifie que `SUPABASE_SECRET_KEY` manque sur l'hébergeur. La ligne est bien écrite : ajoutez la clé, puis **Renvoyer**. Un autre message d'erreur en français vient de la base et dit la vraie raison.

**À vérifier aussi** — Un gestionnaire, connecté comme tel, ne doit **pas** pouvoir choisir le rôle _Administrateur_ dans cette liste. C'est une règle de la base autant que de l'écran.

### 1.2 Activer le compte

**Faire** — Depuis l'autre messagerie, ouvrir le message « Activer mon compte », suivre le lien, choisir un mot de passe.

**Attendu** — L'agent arrive connecté sur son accueil, dans son centre, avec son rôle.

**Sinon** — Un retour vers `localhost` signifie que l'étape 0.2 est fausse. Un écran « Lien d'activation expiré » alors que le message vient d'arriver signifie que le gabarit **Invite user** n'est pas réglé sur `{{ .SiteURL }}/auth/activation?token_hash={{ .TokenHash }}&type=invite` : le lien par défaut ne fonctionne que sur l'appareil qui a fait la demande — c'est-à-dire celui du gestionnaire, jamais celui de l'agent.

**Ce qu'il ne faut pas voir** — À aucun moment le gestionnaire ne voit, ne choisit ni ne transmet le mot de passe de l'agent. Si un écran vous le propose, arrêtez et signalez-le.

### 1.3 Le cas de l'agent qui a déjà un compte

**Faire** — Inviter une adresse qui possède **déjà** un compte DispoSP confirmé, par exemple un agent retiré du centre puis réinvité.

**Attendu** — Le rattachement est **immédiat** : l'agent apparaît dans la liste sans passer par « en attente », et aucun message ne part. Il se connecte comme d'habitude.

**Pourquoi** — Un compte déjà confirmé ne repasse jamais par une confirmation d'adresse. Sans ce second chemin, son invitation resterait en attente indéfiniment, sans aucun recours depuis l'application.

**À vérifier aussi** — Inviter une adresse dont le compte existe mais **n'a jamais été confirmé** : l'invitation doit rester en attente. Une adresse non confirmée ne prend pas de place.

### 1.4 Le rattachement et les droits

**Faire** — L'invité ouvre l'application.

**Attendu** — Il arrive sur son **Accueil** — campagne en cours, avancement, prochaines gardes — et voit **l'espace agent seulement** : Accueil, Disponibilités, Mon planning, Mon profil, Notifications. Ni Planning, ni Besoins, ni Campagnes, ni Agents & équipes, ni Demandes, ni Statistiques, ni Historique, ni Paramètres.

**Sinon** — S'il voit encore « Compte en attente de rattachement », le déclencheur n'a pas trouvé l'invitation : l'adresse saisie ne correspond pas exactement à l'adresse invitée. S'il voit les écrans d'administration, arrêtez et signalez-le — ce serait un défaut de droits, pas de confort.

**Côté administrateur** — L'invitation doit avoir quitté « en attente », et l'agent apparaître dans la liste avec son grade, sa fonction, son matricule et son téléphone modifiables.

### 1.5 Le mot de passe oublié

**Faire** — Se déconnecter, choisir **Mot de passe oublié**, saisir l'adresse de l'agent. Ouvrir le lien reçu, choisir un nouveau mot de passe, puis se reconnecter avec.

**Attendu** — La réponse à l'écran est la même que l'adresse existe ou non : c'est voulu, sinon l'écran deviendrait un annuaire des comptes du centre. Le lien mène à un écran de choix, et le nouveau mot de passe ouvre la session.

**À vérifier aussi** — **Ouvrir le lien sur un autre appareil** que celui qui a fait la demande. S'il échoue, le gabarit d'e-mail n'est pas réglé : mettre « Reset password » sur `{{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&type=recovery`. Sans ce réglage le parcours ne marche que sur l'appareil demandeur, ce qui est précisément le cas le moins fréquent — on demande sur l'ordinateur et on relève ses messages sur le téléphone.

**Sinon** — Un lien déjà utilisé ou périmé doit afficher « Lien expiré » et proposer d'en redemander un. Ils ne servent qu'une fois et durent une heure.

---

## Partie 2 — La campagne

### 2.1 Ouvrir une campagne

**Faire** — Écran **Campagnes**, **Nouvelle campagne**. Nom, mois choisi, date de clôture à venir.

**Attendu** — La campagne s'ouvre et devient active. Sur le tableau de bord, le compteur de réponses affiche 0 sur le nombre d'agents actifs de l'équipe.

**Sinon** — Un refus en français dit lequel des contrôles a mordu (nom trop court, mois invalide, clôture dans le passé). C'est normal et voulu.

**À vérifier** — Ouvrir **Planning**, naviguer sur quelques dates du mois : chaque jour doit proposer un créneau Jour et un créneau Nuit, du 1ᵉʳ au dernier jour. S'il manque des jours ou si la liste des participants est incomplète, la campagne a été créée à moitié — ce que la version atomique doit précisément empêcher.

### 2.2 L'email d'ouverture

**Faire** — Regarder la messagerie de l'agent invité.

**Attendu** — Un message annonçant l'ouverture, portant la marque DispoSP, avec un lien qui mène au site public — pas à `localhost`.

**Sinon** — Si rien n'arrive, la notification existe quand même : l'agent la verra dans **Notifications**. C'est le filet de sécurité. Vérifiez alors les trois variables de l'étape 0.3, puis le tableau de bord Resend (message refusé, domaine non validé, quota).

Rien n'est perdu : la file garde le message et le renverra à la prochaine action.

---

## Partie 3 — La saisie de l'agent

### 3.1 La disponibilité habituelle

**Faire** — Côté agent, **Mes disponibilités**. Dans « Ma disponibilité habituelle », composer une semaine — par exemple lundi indisponible, samedi 24 h. **Enregistrer**, puis **Appliquer au mois**.

**Attendu** — Le panneau annonce d'abord combien de jours seraient renseignés ; après application, tous les lundis et samedis du mois portent la valeur choisie. Les autres jours ne bougent pas.

**Sinon** — Si le bouton Appliquer reste inactif, c'est que le brouillon n'est pas enregistré : c'est voulu, il ne faut pas appliquer autre chose que ce qui est affiché.

**À vérifier** — Se déconnecter, se reconnecter : le modèle doit être toujours là.

### 3.2 La validation explicite

**Faire** — Compléter les jours restants, puis **Valider mes disponibilités**.

**Attendu** — Le bouton reste **inactif tant que le mois n'est pas complet**. Une fois validé, l'écran affiche « Votre réponse est validée » et le tableau de bord de l'administrateur compte une réponse de plus.

**Sinon** — Si la validation passe avec des jours vides, signalez-le : la règle est tenue par la base, pas par l'écran.

### 3.3 La modification après validation

**Faire** — Changer un seul jour.

**Attendu** — La réponse **repasse à valider**, immédiatement. Une nouvelle validation explicite est nécessaire.

**Sinon** — Si la réponse reste validée, la couverture affichée ne correspondrait plus à ce que l'agent a réellement confirmé.

---

## Partie 4 — Le planning

### 4.1 Les besoins d'un créneau

**Faire** — Côté administrateur, **Besoins**, bouton **Appliquer à plusieurs journées** : un effectif et quelques minima de qualification, sur tout le mois. Puis ouvrir **Planning** sur une date et modifier les besoins de ce seul créneau.

**Attendu** — L'écran Besoins montre le mois rempli, et le bandeau « créneaux sans besoin défini » disparaît. Le réglage individuel depuis le planning écrase celui du lot pour cette garde seule.

**Note** — Tant que les besoins ne sont pas définis, un créneau n'est **ni couvert ni en déficit**. L'application ne devine pas un effectif ; elle dit qu'elle ne sait pas, et l'écran Besoins affiche un tiret gris plutôt qu'un zéro.

### 4.2 Affecter, puis publier

**Faire** — Affecter des agents disponibles jusqu'à couvrir l'effectif et les qualifications. Puis **Publier ce créneau**.

**Attendu** — Le bouton de publication reste **inactif tant que la couverture n'est pas atteinte**. Une fois publiée, la version est figée et datée.

**À vérifier** — Essayez de publier un créneau volontairement déficitaire : le refus doit être explicite et dire ce qui manque.

### 4.3 Ce que voit l'agent

**Faire** — Côté agent, **Mon planning**.

**Attendu** — Les gardes publiées uniquement. Les brouillons du gestionnaire ne doivent pas apparaître.

**Sinon** — Si un agent voit un brouillon, il pourrait s'organiser sur une affectation qui n'existe pas encore.

### 4.4 L'email de publication

**Attendu** — L'agent affecté reçoit un message de publication, avec un lien vers son planning.

### 4.5 Un désistement

**Faire** — Côté agent, **Mon planning**, sur la garde publiée : **Je ne peux plus**. Indiquer un motif, envoyer.

**Attendu** — La garde porte « Désistement en attente », et l'agent peut encore le retirer. Côté administrateur, une pastille rouge apparaît sur **Demandes**, et la demande y figure avec le motif. Une notification est arrivée à tous ceux qui encadrent le centre.

**Sinon** — Si le bouton refuse, vérifier que la garde est bien **publiée** : on ne se désiste pas d'un brouillon, et la base l'exige.

**Faire ensuite** — Côté administrateur, **Accepter**.

**Attendu** — L'agent reçoit une réponse, et la demande affiche **« Toujours au planning publié — le remplacement reste à faire »** avec un lien vers la garde. C'est voulu : accepter répond à l'agent, **ça ne réaffecte pas**. Suivre le lien, remplacer l'agent, republier — le rappel disparaît alors.

**Sinon** — Si accepter suffisait à retirer l'agent du planning publié, le créneau se retrouverait publié en déficit. La base refuse précisément cela.

---

## Partie 5 — Rappel et clôture

### 5.1 Le rappel avant clôture

**Faire** — Côté administrateur, déclencher le rappel depuis le tableau de bord ou l'écran Campagnes.

**Attendu** — Seuls les agents **n'ayant pas validé** le reçoivent. Un second rappel pour la même campagne doit être refusé tant que le premier est en attente.

**À savoir** — **Ce rappel est un geste manuel.** Rien ne le déclenche tout seul : il n'y a pas d'ordonnanceur. Si vous voulez qu'il parte trois jours avant la clôture, il faut que quelqu'un s'en charge. Notez-le dans vos habitudes de service.

### 5.2 La clôture

**Faire** — Clôturer la campagne.

**Attendu** — La saisie n'est plus possible, avec un message clair côté agent.

---

## Partie 6 — Ce qui sort de l'application

**Faire** — Depuis la synthèse : **Exporter en Excel**, **Exporter la vue CSV**, **Imprimer le mois**. Depuis Mon planning : **Exporter mon calendrier**.

**Attendu**

- Le classeur Excel s'ouvre avec ses six feuilles et les vraies données du mois.
- Le CSV reprend la vue **filtrée** telle qu'elle est affichée, avec les accents corrects.
- L'aperçu d'impression montre **tous les agents** et les 31 colonnes, en paysage, avec le logo et le nom du centre en haut de chaque page.
- Le fichier `.ics` s'importe dans un agenda et y place les bonnes gardes aux bonnes heures.

**Sinon** — Si l'impression ne montre qu'une partie des agents, dites-le : c'est exactement le défaut qui a été corrigé, et il serait revenu.

---

## Partie 7 — Les droits

Ces vérifications ne sont pas du confort. Elles portent sur des données personnelles.

**Faire, côté agent** — Tenter d'ouvrir directement `/agents`, `/besoins`, `/demandes`, `/statistiques`, `/historique`, `/parametres`, `/planning` et `/tableau-de-bord` en tapant l'adresse.

**Attendu** — Un écran « Accès réservé », et **aucune donnée**. `/tableau-de-bord` fait exception : il renvoie l'agent vers son accueil, parce qu'un agent n'y verrait qu'une synthèse du centre calculée sur une seule personne — la sienne.

**Faire, côté agent** — Ouvrir **Demandes** d'un autre centre n'est pas possible ; vérifier plutôt qu'un agent ne voit que **ses propres** désistements, jamais ceux d'un collègue.

**Faire, côté administrateur** — Chercher la disponibilité habituelle d'un agent.

**Attendu** — On ne la trouve nulle part. Le modèle personnel d'un agent n'est visible que de lui : il ne dit pas ce qu'il fera, mais ce qu'il fait d'habitude, et aucun écran de pilotage n'en a besoin.

---

## Partie 8 — Le téléphone

### 8.1 Installer l'application

**Faire** — Ouvrir le site public sur un téléphone. Sur Android : la bannière d'installation, ou **Mon profil → Installer l'application**. Sur iPhone : Safari, bouton Partager, « Sur l'écran d'accueil ».

**Attendu** — Une icône DispoSP sur l'écran d'accueil. L'application s'ouvre en plein écran, sans barre d'adresse.

**À vérifier** — Couper la connexion et ouvrir l'application : une page « Pas de connexion » doit s'afficher, et **aucune donnée ancienne**. C'est voulu : un planning servi depuis un cache serait présenté comme à jour sans l'être.

### 8.2 Activer les notifications

**Sur iPhone, faites-le depuis l'application installée à l'étape 8.1**, pas depuis Safari : Apple ne permet les notifications que là. Sur Android, l'onglet suffit.

**Faire** — Se connecter avec le compte agent sur ce téléphone, et attendre une seconde.

**Attendu** — Une fenêtre demande « Être prévenu sur cet appareil ? ». Elle ne se pose qu'une fois : c'est à elle que la plupart des agents répondront, le profil n'étant trouvé que par qui le cherche.

**À vérifier, et c'est le cœur de l'étape** — Touchez « Non merci », puis déconnectez-vous et reconnectez-vous : **la fenêtre ne doit pas revenir**. Le bouton reste disponible dans **Mon profil**. Recommencez ensuite en acceptant : elle ne doit pas revenir non plus.

**Sinon** — Si la fenêtre revient à chaque connexion, la réponse n'a pas pu être gardée : navigation privée, ou stockage du navigateur bloqué. L'application reste utilisable, mais l'agent sera sollicité à chaque fois — à signaler.

**Faire** — Depuis la fenêtre, ou par **Mon profil → Notifications sur cet appareil → Activer les notifications**, accepter la demande du téléphone. Puis **Envoyer un essai**.

**Attendu** — Le panneau annonce « Actives sur cet appareil. », et la bulle d'essai arrive en quelques secondes. Verrouillez l'écran et renvoyez un essai : elle doit arriver aussi.

**Sinon** — Si le panneau dit « Le navigateur les a bloquées », l'autorisation a été refusée une fois : une page ne peut plus la redemander, il faut rouvrir DispoSP dans les réglages du téléphone. Si l'essai part sans rien afficher, désactivez puis réactivez — l'abonnement de l'appareil n'était plus valable.

### 8.3 Recevoir pour de vrai

**Faire** — Avec le compte administrateur, sur un autre appareil, ouvrir une campagne ou publier un créneau qui concerne l'agent. **Fermer l'application sur le téléphone de l'agent** — pas seulement la mettre en arrière-plan.

**Attendu** — La bulle arrive sur l'écran verrouillé dans la minute. Elle dit ce qui s'est passé — « Une campagne de disponibilités est ouverte. » — et **rien de plus** : ni nom, ni date de garde, ni motif. C'est voulu : un écran verrouillé se lit par-dessus l'épaule. Toucher la bulle ouvre l'application sur le centre de messages.

**À vérifier** — L'ordinateur de l'agent, sur lequel il n'a rien activé, ne reçoit rien. L'activation vaut pour un appareil, pas pour un compte.

**Sinon** — La notification existe quand même dans **Notifications**, et l'email est parti. C'est le filet : la bulle est un rappel, jamais le canal officiel. Vérifiez alors l'étape 0.6 — migrations passées, trois variables présentes, construction refaite après un changement de clé publique.

---

## Partie 9 — L'exploitation

Ce ne sont pas des tests mais des préparations. Elles conditionnent la mise en service autant que le reste.

### 9.1 La sauvegarde

**Faire** — Vérifier la fréquence des sauvegardes du projet Supabase, puis **restaurer une sauvegarde sur un projet d'essai**.

**Attendu** — La restauration aboutit et les données sont là.

**Pourquoi** — Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde. C'est une hypothèse.

### 9.2 Les données personnelles

L'application détient des noms, des numéros de téléphone, des matricules, des grades et les disponibilités de chacun. Trois décisions à écrire, une fois :

- **Informer les agents** : ce qui est collecté, pourquoi, qui y accède, combien de temps.
- **Fixer une durée de conservation** : combien de temps garde-t-on les campagnes passées et le journal d'audit.
- **Décrire l'effacement** : que fait-on quand un agent quitte le centre. Aujourd'hui l'application permet de **désactiver** un agent — il ne compte plus dans aucune synthèse et ne peut plus être affecté — mais ne l'efface pas.

### 9.3 Le suivi

Prévoir où regarder quand quelque chose ne va pas : les logs de l'hébergeur, ceux de Supabase, le tableau de bord Resend pour les messages refusés.

---

## Ce que cette recette ne couvre pas

À dire franchement, pour que personne ne croie le contraire :

- **La charge.** Elle se fait à deux ou trois personnes. Le comportement avec trente agents connectés le même soir n'est pas mesuré.
- **La concurrence.** Si deux responsables modifient le même brouillon de planning en même temps, le dernier qui écrit gagne, sans avertissement. À un seul responsable par équipe, cela ne se verra pas.
- **Plusieurs centres.** Tout est éprouvé sur une seule organisation.
- **La durée.** Un mois de recette ne dit rien de ce qui se passe au bout d'un an de campagnes accumulées.
- **Le parc de téléphones.** Les notifications poussées sont vérifiées sur les appareils de la recette, pas sur tous les modèles ni tous les réglages d'économie d'énergie. Un délai de remise dépend du service de Google ou d'Apple, pas de l'application.

---

## Journal de recette

| Étape | Date | Par | Résultat | Remarque |
| ----- | ---- | --- | -------- | -------- |
| 0.1   |      |     |          |          |
| 0.2   |      |     |          |          |
| 0.3   |      |     |          |          |
| 0.4   |      |     |          |          |
| 1.1   |      |     |          |          |
| 1.2   |      |     |          |          |
| 1.3   |      |     |          |          |
| 1.4   |      |     |          |          |
| 1.5   |      |     |          |          |
| 2.1   |      |     |          |          |
| 2.2   |      |     |          |          |
| 3.1   |      |     |          |          |
| 3.2   |      |     |          |          |
| 3.3   |      |     |          |          |
| 4.1   |      |     |          |          |
| 4.2   |      |     |          |          |
| 4.3   |      |     |          |          |
| 4.4   |      |     |          |          |
| 4.5   |      |     |          |          |
| 5.1   |      |     |          |          |
| 5.2   |      |     |          |          |
| 6     |      |     |          |          |
| 7     |      |     |          |          |
| 8     |      |     |          |          |
| 9.1   |      |     |          |          |
| 9.2   |      |     |          |          |
| 9.3   |      |     |          |          |
