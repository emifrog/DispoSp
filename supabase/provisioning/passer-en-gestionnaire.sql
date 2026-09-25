-- Passage d'un compte en GESTIONNAIRE.
--
-- À exécuter dans l'éditeur SQL du tableau de bord Supabase, où la requête tourne
-- avec les droits du propriétaire. Le client ne peut pas faire ce geste lui-même :
-- la migration 0004 réserve le changement de rôle à un ADMIN, et interdit à
-- quiconque de modifier son propre rôle. Les deux règles sont voulues.
--
-- Une inscription ne crée ni profil ni rattachement. Seul le déclencheur
-- accept_invitation de 0004 le fait, et seulement s'il trouve une invitation en
-- attente pour l'adresse confirmée. Un compte créé sans invitation n'a donc rien
-- du tout : ce script écrit le profil ET le rattachement quand ils manquent, et
-- se contente de corriger le rôle quand ils existent déjà.
--
-- Adaptez les trois valeurs ci-dessous, puis exécutez le fichier entier.
--
-- Pas de begin/commit autour : un bloc `do` est déjà une instruction unique, donc
-- atomique. En ajouter un ferait échouer le `commit` après un refus, et le vrai
-- message se perdrait derrière un « current transaction is aborted ».

do $$
declare
  compte constant text := 'gestionnaire@exemple.fr';
  nom    constant text := 'Prénom Nom';
  -- Nom de l'équipe de rattachement. Laisser null pour prendre la première du
  -- centre ; ignoré si le compte est déjà rattaché, on ne le déplace pas.
  equipe constant text := null;
  cible uuid;
  confirme timestamptz;
  centre uuid;
  section uuid;
  actuel text;
  actif boolean;
  rattachements int;
  centres int;
begin
  select id, email_confirmed_at into cible, confirme from auth.users where email = compte;
  if cible is null then
    raise exception 'Aucun compte pour %. Inscrivez-vous d''abord depuis la page de connexion.', compte;
  end if;
  -- Pas bloquant pour le rattachement, mais la connexion, elle, le sera si la
  -- confirmation d'adresse est exigée côté Authentication.
  if confirme is null then
    raise notice 'Adresse non confirmée pour %. Le rattachement est écrit, mais la connexion échouera tant que le message d''inscription n''est pas ouvert.', compte;
  end if;

  select count(*) into rattachements from public.memberships where user_id = cible;
  if rattachements > 1 then
    raise exception 'Le compte % est rattaché à % centres. readSession n''en lit qu''un (maybeSingle) : retirez le rattachement de trop avant de continuer.', compte, rattachements;
  end if;

  select organization_id, role, active into centre, actuel, actif from public.memberships where user_id = cible;

  if centre is null then
    -- Aucun rattachement : il faut choisir un centre, et le script refuse de
    -- deviner s'il y en a plusieurs.
    select count(*) into centres from public.organizations;
    if centres = 0 then
      raise exception 'Aucune organisation dans cette base. Exécutez d''abord premiere-organisation.sql.';
    end if;
    if centres > 1 then
      raise exception 'Plusieurs organisations dans cette base : précisez laquelle en remplaçant la résolution automatique ci-dessous.';
    end if;
    select id into centre from public.organizations;

    if equipe is null then
      select id into section from public.teams where organization_id = centre order by name limit 1;
    else
      select id into section from public.teams where organization_id = centre and name = equipe;
    end if;
    if section is null then
      raise exception 'Aucune équipe trouvée dans le centre %. Une équipe est obligatoire : memberships porte une clé étrangère composite vers teams.', centre;
    end if;
  end if;

  -- profiles d'abord : memberships.user_id référence profiles.user_id, pas
  -- auth.users. Un rattachement sans profil est impossible.
  insert into public.profiles (user_id, display_name) values (cible, nom)
    on conflict (user_id) do update set display_name = excluded.display_name;

  if actuel is null then
    insert into public.memberships (organization_id, user_id, team_id, role, active)
      values (centre, cible, section, 'GESTIONNAIRE', true);
    raise notice 'Compte % rattaché au centre % en GESTIONNAIRE.', compte, centre;
  else
    -- Le déclencheur membership_change de 0004 est en « security invoker » : ici
    -- auth.uid() est null, donc is_administrator() répond faux et il refuserait
    -- le changement de rôle. On l'écarte le temps de la mise à jour.
    --
    -- Le DDL est transactionnel sous Postgres : si la suite échoue, la
    -- désactivation est annulée avec le reste. Le déclencheur ne peut pas rester
    -- éteint derrière un échec.
    --
    -- Écarter le déclencheur écarte aussi sa règle du dernier administrateur
    -- (20260922100000). Elle est donc reprise ici : sans administrateur actif,
    -- plus personne ne change un rôle ni n'invite un administrateur depuis
    -- l'application, et le centre est verrouillé de l'intérieur.
    if actuel = 'ADMIN' and actif and private.active_administrators(centre) <= 1 then
      raise exception
        'Le compte % est le dernier administrateur actif du centre : nommez-en un autre avant de le passer en GESTIONNAIRE.',
        compte;
    end if;
    alter table public.memberships disable trigger membership_change;
    update public.memberships set role = 'GESTIONNAIRE', active = true
      where organization_id = centre and user_id = cible;
    alter table public.memberships enable trigger membership_change;
    raise notice 'Compte % : rôle % remplacé par GESTIONNAIRE dans le centre %.', compte, actuel, centre;
  end if;

  -- Une invitation restée en attente pour cette adresse n'attacherait plus rien
  -- — le compte vient d'être rattaché — mais encombrerait le panneau
  -- « Invitations en attente ». On la solde.
  update public.invitations set accepted_at = now(), accepted_by = cible
    where organization_id = centre and email = lower(btrim(compte)) and accepted_at is null;
end
$$;

-- Le journal d'audit enregistre le passage (entity « membership », action
-- « ROLE » ou « JOIN »), mais avec un auteur vide : auth.uid() est null dans
-- l'éditeur SQL. C'est exact — personne dans l'application n'a fait ce geste.
--
-- Pour vérifier avant de retourner dans l'application :
--
--   select u.email, m.role, m.active, o.name as centre, t.name as equipe
--     from auth.users u
--     join public.memberships m on m.user_id = u.id
--     join public.organizations o on o.id = m.organization_id
--     join public.teams t on t.id = m.team_id
--    where u.email = 'gestionnaire@exemple.fr';
