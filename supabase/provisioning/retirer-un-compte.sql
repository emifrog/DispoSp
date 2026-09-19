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
-- Ce que ce script NE fait PAS disparaître : le journal d'audit. La colonne
-- actor_id est en « on delete set null » — les actions restent, leur auteur
-- devient anonyme. C'est la traçabilité du §12 : elle survit au départ de la
-- personne, sans conserver son identité.
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

    -- Une affectation publiée engage un agent sur une garde. L'effacer en
    -- silence changerait un planning que des gens ont lu.
    select count(*) into affectations
      from public.schedule_assignments a
      join public.schedule_shifts s on s.id = a.schedule_shift_id
      where (a.user_id = cible or a.assigned_by = cible) and s.published_revision is not null;
    if affectations > 0 then
      raise notice
        'Attention : % affectation(s) publiée(s) concernent ce compte et vont être effacées. Les plannings déjà consultés ne les montreront plus.',
        affectations;
    end if;
  end if;

  -- L'ordre suit les dépendances, du plus dépendant au plus porteur.
  delete from public.availability_entries where user_id = cible;
  delete from public.campaign_participants where user_id = cible;
  delete from public.availability_templates where user_id = cible;
  delete from public.user_qualifications where user_id = cible;
  delete from public.schedule_assignments where user_id = cible or assigned_by = cible;
  delete from public.notifications where user_id = cible;
  delete from public.invitations where invited_by = cible;
  delete from public.memberships where user_id = cible;
  delete from public.profiles where user_id = cible;

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
