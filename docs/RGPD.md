# DispoSP — Protection des données personnelles

_23 septembre 2026. Document de travail à valider avec le délégué à la protection des données (DPO) du SDIS avant la mise en service._

Ce document réunit ce qu'il faut au DPO pour inscrire DispoSP au registre des traitements (art. 30 du RGPD) et pour instruire les demandes des agents. Tout ce qui décrit l'application est vérifié dans le code. Ce qui relève d'un choix juridique (base légale, durées, analyse d'impact) est présenté comme une **proposition** et doit être tranché par le DPO.

## 1. Le traitement en une fiche

| Rubrique                  | Contenu                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom                       | DispoSP : recueil des disponibilités et planification des gardes                                                                                                                                                                              |
| Responsable de traitement | Le SDIS (à compléter : service, représentant)                                                                                                                                                                                                 |
| Finalité                  | Recueillir chaque mois les disponibilités des sapeurs-pompiers d'un centre, construire et publier le planning des gardes, gérer les désistements                                                                                              |
| Base légale **proposée**  | Mission d'intérêt public (art. 6.1.e) : organisation opérationnelle du service d'incendie et de secours. **À confirmer par le DPO.**                                                                                                          |
| Personnes concernées      | Les agents du centre (sapeurs-pompiers professionnels et volontaires) et leur encadrement                                                                                                                                                     |
| Destinataires internes    | L'agent voit ses propres données. Les gestionnaires et administrateurs du centre voient celles des agents du centre. Aucun autre centre n'y a accès : la séparation est appliquée en base par des politiques de sécurité au niveau des lignes |
| Transferts hors UE        | À vérifier pour chaque sous-traitant (section 3)                                                                                                                                                                                              |

## 2. Données traitées

| Catégorie    | Données                                                                                                                                                                                              | Source                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Identité     | Nom affiché, grade, fonction, matricule                                                                                                                                                              | Saisie par l'encadrement à l'invitation ou sur la fiche        |
| Coordonnées  | Adresse email, téléphone                                                                                                                                                                             | Idem ; l'email sert aussi d'identifiant de connexion           |
| Compétences  | Qualifications détenues (INC1, SAP1…), avec leur date d'obtention                                                                                                                                    | Encadrement                                                    |
| Organisation | Disponibilités par jour, réponse validée, gardes affectées et publiées, désistements                                                                                                                 | Agent (disponibilités, désistements) et encadrement (planning) |
| Texte libre  | Commentaire sur une disponibilité, **motif d'un désistement**                                                                                                                                        | Agent                                                          |
| Traçabilité  | Journal d'audit : auteur, date, action, valeur avant et après                                                                                                                                        | Base, automatiquement                                          |
| Technique    | Abonnement aux notifications poussées de l'appareil (adresse du service de notification, clés de chiffrement), horodatages de connexion et adresses IP dans les journaux d'authentification Supabase | Navigateur, Supabase Auth                                      |

**Point d'attention : le texte libre.** Rien n'empêche un agent d'écrire « arrêt maladie » ou « enfant hospitalisé » en commentaire ou en motif de désistement. Ce serait une donnée de santé (art. 9). Le motif d'un désistement est aussi **recopié dans la notification envoyée par email à tout l'encadrement du centre**. Deux mesures sont possibles, au choix du DPO :

- une mention sous ces champs : « N'indiquez pas de raison médicale » ;
- la suppression du motif dans l'email, qui ne garderait que « un agent se désiste de la garde du… ».

## 3. Sous-traitants

| Sous-traitant                                                                | Rôle                                          | Données reçues                                                                              | À faire                                                                                                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Supabase                                                                     | Base de données, authentification             | Toutes                                                                                      | Signer le DPA ; **vérifier que le projet est hébergé dans une région de l'UE** (réglage du projet, non modifiable après création) |
| Resend                                                                       | Envoi des emails (invitations, notifications) | Adresse, sujet et texte du message, y compris le motif d'un désistement                     | Signer le DPA ; vérifier le mécanisme de transfert (Resend est une société américaine)                                            |
| Hébergeur de l'application                                                   | Exécution du serveur Next.js                  | Toutes, en transit                                                                          | **Pas encore choisi** ; choisir une région UE et signer le DPA                                                                    |
| Services de notification des navigateurs (Google, Mozilla, Apple, Microsoft) | Acheminement des notifications poussées       | Un message générique (« Votre planning a été publié ou modifié. »), chiffré de bout en bout | Aucune donnée nominative ne leur parvient ; rien à signer                                                                         |

## 4. Durées de conservation proposées

Ce sont les valeurs réglées dans `supabase/provisioning/purger-les-donnees-anciennes.sql`. **Elles restent des propositions tant que le DPO ne les a pas validées.** Pour les plannings publiés, le service RH ou finances doit dire s'ils servent de justificatif (indemnisation des volontaires, par exemple), ce qui allongerait leur durée.

| Données                                                                                       | Durée proposée                        | Justification                                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Campagnes terminées (disponibilités, réponses, besoins, planning, affectations, désistements) | 24 mois après la fin du mois concerné | Statistiques d'activité sur deux ans ; au-delà, plus d'usage opérationnel                                        |
| Journal d'audit                                                                               | 12 mois                               | Durée usuelle d'un journal de traçabilité                                                                        |
| Notifications (et leurs envois)                                                               | 6 mois                                | Elles n'ont plus d'intérêt une fois lues                                                                         |
| Invitations, acceptées ou non                                                                 | 3 mois                                | Elles recopient nom, email, téléphone et matricule ; inutiles une fois le compte créé ou l'invitation abandonnée |
| Compte, fiche, rattachement                                                                   | Tant que l'agent appartient au centre | Retrait à son départ (section 5)                                                                                 |

La purge **n'est pas automatique** : elle s'exécute à la main dans l'éditeur SQL de Supabase, **une fois par mois**, et chaque exécution affiche ce qu'elle a effacé. Il faut désigner qui s'en charge. Pour l'automatiser, il faudra planifier la tâche, par exemple avec `pg_cron` sur Supabase, ce qui n'est pas fait.

## 5. Droits des personnes : procédures

Toutes les procédures s'exécutent par l'administrateur technique dans l'éditeur SQL du tableau de bord Supabase, sur demande transmise par le DPO. Elles sont testées sur une base PostgreSQL réelle (`tests/database.test.ts`).

| Droit                                | Procédure                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accès, portabilité (art. 15, 20)     | `supabase/provisioning/exporter-les-donnees-d-un-compte.sql` rend un document JSON unique : compte, fiche, rattachements, qualifications, disponibilité habituelle, campagnes et disponibilités, gardes, désistements, notifications, appareils abonnés, invitations et lignes du journal qui concernent la personne. Il ne modifie rien.                                                        |
| Rectification (art. 16)              | Dans l'application : un gestionnaire ou un administrateur modifie la fiche (nom, grade, fonction, matricule, téléphone, qualifications). L'agent ne peut pas modifier sa fiche lui-même.                                                                                                                                                                                                         |
| Effacement (art. 17)                 | `supabase/provisioning/retirer-un-compte.sql`, puis la suppression du compte dans Authentication → Users. Le script efface tout ce qui appartient à la personne et **retire ses coordonnées du journal d'audit** (nom, téléphone, matricule, grade, fonction, email, commentaires, motifs). Les lignes du journal restent, anonymisées : l'action a eu lieu, son auteur n'est plus identifiable. |
| Limitation, opposition (art. 18, 21) | Désactiver le compte depuis l'écran Agents : l'agent perd l'accès, ses données restent en l'état.                                                                                                                                                                                                                                                                                                |

**Limites connues de l'effacement :**

- Les notifications déjà reçues par l'encadrement au sujet d'un désistement de la personne (« X se désiste de la garde… Motif : … ») restent dans la boîte de ces destinataires, jusqu'à leur purge au bout de 6 mois.
- Les emails envoyés via Resend restent dans les messageries de leurs destinataires.
- Les journaux d'authentification de Supabase suivent la politique de rétention de Supabase.

## 6. Sécurité

- **Cloisonnement :** chaque lecture et chaque écriture passe par des politiques de sécurité au niveau des lignes en base. Un agent ne lit que ses données, et un centre ne voit jamais un autre centre. Les clés d'administration ne quittent pas le serveur.
- **Transport :** HTTPS imposé par HSTS. La politique de sécurité du contenu interdit tout script, cadre ou connexion vers un autre serveur que l'application et Supabase.
- **Traçabilité :** chaque modification est journalisée avec son auteur, et le journal n'est modifiable par aucun utilisateur de l'application.
- **Limites d'envoi :** un rappel par campagne toutes les douze heures. Pour les invitations : cinq envois au plus par invitation, un quart d'heure entre deux envois, cinquante par heure et par centre.
- **Messages sans fuite :** l'application ne révèle pas à un gestionnaire qu'une adresse a un compte dans un autre centre.

## 7. Reste à faire avant la mise en service

- [ ] Valider la base légale et les durées de conservation (sections 1 et 4)
- [ ] Décider du traitement du texte libre et du motif de désistement dans les emails (section 2)
- [ ] Vérifier la région du projet Supabase ; signer les DPA Supabase et Resend
- [ ] Choisir l'hébergeur (région UE) et signer son DPA
- [ ] Décider si une analyse d'impact (AIPD) est nécessaire
- [ ] Informer les agents (art. 13) : une notice à afficher à la connexion ou à remettre à l'invitation, qui reprend les sections 1 à 5
- [ ] Désigner qui exécute la purge mensuelle et les demandes d'exercice des droits
- [ ] Inscrire le traitement au registre
