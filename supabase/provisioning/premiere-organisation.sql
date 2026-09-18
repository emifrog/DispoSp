-- Provisionnement de la première organisation.
--
-- Le schéma interdit volontairement au client de créer organisations, équipes et
-- rôles : cette opération se fait donc ici, dans l'éditeur SQL du tableau de
-- bord Supabase, où la requête s'exécute avec les droits du propriétaire.
--
-- Prérequis : le compte doit exister ET son adresse être confirmée.
-- Adaptez les quatre valeurs ci-dessous, puis exécutez le fichier entier.

begin;
do $$
declare
  admin_email constant text := 'a.remplacer@example.org';
  admin_name  constant text := 'Prénom Nom';
  org_name    constant text := 'CIS Val de Loire';
  team_name   constant text := 'Équipe Alpha';
  admin_id uuid;
  confirmed timestamptz;
  org_id uuid;
  team_id uuid;
begin
  select id, email_confirmed_at into admin_id, confirmed from auth.users where email = admin_email;
  if admin_id is null then
    raise exception 'Aucun compte pour %. Inscrivez-vous d''abord depuis la page de connexion.', admin_email;
  end if;
  if confirmed is null then
    raise exception 'Le compte % existe mais son adresse n''est pas confirmée. Ouvrez le message reçu à l''inscription.', admin_email;
  end if;
  if exists (select 1 from public.memberships where user_id = admin_id) then
    raise exception 'Le compte % est déjà rattaché à une organisation. Ce script ne s''exécute qu''une fois.', admin_email;
  end if;

  insert into public.profiles (user_id, display_name) values (admin_id, admin_name)
    on conflict (user_id) do update set display_name = excluded.display_name;

  insert into public.organizations (name) values (org_name) returning id into org_id;
  insert into public.teams (organization_id, name) values (org_id, team_name) returning id into team_id;

  -- ADMIN : le seul rôle qui puisse ensuite rattacher les autres agents.
  insert into public.memberships (organization_id, user_id, team_id, role, active)
    values (org_id, admin_id, team_id, 'ADMIN', true);

  -- Horaires par défaut de l'organisation. Chaque campagne fige les siens à sa
  -- création, donc les modifier ici ne déplace aucune disponibilité déjà saisie.
  insert into public.shift_types (organization_id, code, starts_at_hour, duration_hours)
    values (org_id, 'DAY', 8, 12), (org_id, 'NIGHT', 20, 12);

  insert into public.qualifications (organization_id, name)
    values (org_id, 'Chef'), (org_id, 'Conducteur PL'), (org_id, 'SAP'), (org_id, 'Équipier INC');

  raise notice 'Organisation % créée, équipe %, compte % rattaché en ADMIN.', org_id, team_id, admin_email;
end
$$;
commit;
