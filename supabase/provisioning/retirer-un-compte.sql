-- Retrait d'un compte et de ses données.
--
-- À exécuter dans l'éditeur SQL du tableau de bord Supabase, où la requête tourne
-- avec les droits du propriétaire : le schéma interdit volontairement au client
-- de défaire un rattachement.
--
-- Toutes les clés étrangères vers un membre sont en « on delete restrict ». Rien
-- ne part en cascade, et c'est voulu : on efface dans l'ordre, explicitement, ou
-- la transaction échoue. Elle échoue en entier, sans état partiel.
--
-- Ce que ce script NE fait PAS disparaître : les lignes du journal d'audit. La
-- colonne actor_id est en « on delete set null » — les actions restent, leur
-- auteur devient anonyme. C'est la traçabilité du §12 : elle survit au départ de
-- la personne, sans conserver son identité.
--
-- Ce qu'il en retire, en revanche : les coordonnées que le journal avait
-- recopiées. Chaque modification d'une fiche y inscrit l'avant et l'après —
-- nom, téléphone, matricule —, chaque saisie son commentaire, chaque
-- désistement son motif, et une invitation y est désignée par son adresse. Ces
-- valeurs sont effacées des lignes qui concernent le compte ; l'action, la
-- date et l'entité restent.
--
-- C'est la procédure d'effacement (RGPD, art. 17) : voir docs/RGPD.md.
--
-- Adaptez l'adresse, puis exécutez le fichier entier.
--
-- Pas de begin/commit autour : un bloc `do` est déjà une instruction unique, donc
-- atomique. En ajouter un ferait échouer le `commit` après un refus, et le vrai
-- message se perdrait derrière un « current transaction is aborted ».

do $$
declare
  compte constant text := 'agent.qui.part@exemple.fr';
  cible uuid;
  centre uuid;
  releve uuid;
  affectations int;
  restants int;
begin
  select id into cible from auth.users where email = compte;
  if cible is null then
    raise exception 'Aucun compte pour %.', compte;
  end if;

  select organization_id into centre from public.memberships where user_id = cible;
  if centre is null then
    raise notice 'Le compte % n''est rattaché à aucun centre : seul le profil sera retiré.', compte;
  else
    -- Un centre sans administrateur ne peut plus rattacher personne, et le
    -- schéma interdit de se rattacher soi-même : la porte se refermerait de
    -- l'intérieur. On vérifie qu'il en reste un autre, actif, avant d'effacer.
    select count(*) into restants
      from public.memberships
      where organization_id = centre and user_id <> cible and active
        and role in ('GESTIONNAIRE', 'ADMIN');
    if restants = 0 then
      raise exception
        'Retirer % laisserait le centre sans administrateur actif : plus personne ne pourrait inviter un agent. Créez d''abord un compte GESTIONNAIRE ou ADMIN.',
        compte;
    end if;

    -- Ce que ce compte a fait pour les autres — affecter, trancher un
    -- désistement, inviter — reste fait : ces lignes passent au nom d'un autre
    -- membre de l'encadrement, un administrateur de préférence. Les effacer
    -- aurait retiré du planning publié des gardes qui ne sont pas les siennes.
    select user_id into releve
      from public.memberships
      where organization_id = centre and user_id <> cible and active
        and role in ('GESTIONNAIRE', 'ADMIN')
      order by case role when 'ADMIN' then 0 else 1 end, user_id
      limit 1;

    -- Une affectation publiée engage un agent sur une garde. L'effacer en
    -- silence changerait un planning que des gens ont lu.
    select count(*) into affectations
      from public.schedule_assignments a
      where a.user_id = cible and a.revision > 0;
    if affectations > 0 then
      raise notice
        'Attention : % affectation(s) publiée(s) concernent ce compte et vont être effacées. Les plannings déjà consultés ne les montreront plus.',
        affectations;
    end if;
  end if;

  -- L'ordre suit les dépendances, du plus dépendant au plus porteur.
  delete from public.push_deliveries d using public.push_subscriptions s
    where d.subscription_id = s.id and s.user_id = cible;
  delete from public.push_subscriptions where user_id = cible;
  -- Le déclencheur de saisie refuse toute suppression sur une campagne close,
  -- et celle d'un mois passé l'est toujours : le retrait échouait pour presque
  -- tout agent. Il est suspendu le temps de cet effacement seulement ; un échec
  -- plus loin annule le bloc entier, suspension comprise.
  alter table public.availability_entries disable trigger availability_write;
  delete from public.availability_entries where user_id = cible;
  alter table public.availability_entries enable trigger availability_write;
  delete from public.campaign_participants where user_id = cible;
  delete from public.availability_templates where user_id = cible;
  delete from public.user_qualifications where user_id = cible;
  delete from public.shift_withdrawals where user_id = cible;
  update public.shift_withdrawals set decided_by = releve where decided_by = cible;
  delete from public.schedule_assignments where user_id = cible;
  update public.schedule_assignments set assigned_by = releve where assigned_by = cible;
  delete from public.notifications where user_id = cible;
  -- L'invitation qui l'a fait entrer part avec lui : sa clé accepted_by
  -- empêcherait sinon de supprimer le compte, et son adresse ne pourrait plus
  -- être réinvitée. Celles qu'il a faites passent au relais.
  delete from public.invitations where accepted_by = cible;
  -- Le journal des envois d'invitation garde l'adresse, invitation effacée ou non.
  delete from private.invitation_sends where email = lower(btrim(compte));
  update public.invitations set invited_by = releve where invited_by = cible;
  delete from public.memberships where user_id = cible;
  delete from public.profiles where user_id = cible;

  -- Le journal, en dernier : les suppressions ci-dessus y ont elles-mêmes
  -- inscrit des lignes, qui recopient ce qui vient d'être effacé.
  update public.audit_logs l set
    entity_id = case when l.entity_id = compte then 'compte retiré' else l.entity_id end,
    old_value = l.old_value - array['display_name', 'phone', 'matricule', 'grade', 'fonction', 'email', 'comment', 'reason'],
    new_value = l.new_value - array['display_name', 'phone', 'matricule', 'grade', 'fonction', 'email', 'comment', 'reason']
   where l.entity_id in (cible::text, compte)
      or l.old_value ->> 'user_id' = cible::text
      or l.new_value ->> 'user_id' = cible::text
      or l.old_value ->> 'accepted_by' = cible::text
      or l.new_value ->> 'accepted_by' = cible::text;

  raise notice 'Données retirées pour %. Supprimez maintenant le compte lui-même dans Authentication → Users.', compte;
end
$$;

-- Le compte d'authentification se supprime depuis le tableau de bord
-- (Authentication → Users → … → Delete user), pas ici : l'effacement d'une
-- identité est un geste qui se fait à la main, en le regardant.
--
-- Pour vérifier qu'il ne reste rien avant de le faire :
--
--   select 'memberships' as t, count(*) from public.memberships m
--     join auth.users u on u.id = m.user_id where u.email = 'agent.qui.part@exemple.fr'
--   union all select 'profiles', count(*) from public.profiles p
--     join auth.users u on u.id = p.user_id where u.email = 'agent.qui.part@exemple.fr';
