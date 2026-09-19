-- Grades, fonctions, et resserrement des rôles sur trois valeurs.
--
-- Trois changements qui vont ensemble parce qu'ils décrivent la même réalité :
-- un centre où l'on porte un grade ET une fonction, et où il n'y a pas de
-- responsable d'équipe distinct du gestionnaire.
--
-- S'applique par-dessus 0007. À coller en entier : la transaction annule tout
-- sur la moindre erreur.
begin;

do $$
begin
  if to_regclass('public.invitations') is null then
    raise exception 'Appliquez d''abord 0004_agent_administration.sql : public.invitations est absente';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'fonction') then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Trois rôles au lieu de quatre.
-- ---------------------------------------------------------------------------

-- RESPONSABLE disparaît. Les comptes qui le portent passent GESTIONNAIRE :
-- c'est une extension de droits — d'une équipe au centre entier, plus le droit
-- d'inviter — assumée et tracée dans le journal d'audit ci-dessous.
--
-- Le déclencheur membership_change de 0004 est en « security invoker » : ici
-- auth.uid() est null, donc is_administrator() répond faux et il refuserait le
-- changement. On l'écarte le temps de la conversion. Le DDL étant
-- transactionnel, un échec plus bas le remet en place avec le reste.
alter table public.memberships disable trigger membership_change;
update public.memberships set role = 'GESTIONNAIRE' where role = 'RESPONSABLE';
alter table public.memberships enable trigger membership_change;

-- Une invitation encore en attente porte elle aussi un rôle, qui sera recopié
-- tel quel dans memberships par accept_invitation. La laisser à RESPONSABLE
-- créerait un rattachement invalide au moment de la confirmation d'adresse.
update public.invitations set role = 'GESTIONNAIRE' where role = 'RESPONSABLE';

-- Les deux contraintes sont nées sans nom explicite : Postgres les a nommées
-- d'après la table et la colonne.
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('AGENT', 'GESTIONNAIRE', 'ADMIN'));
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('AGENT', 'GESTIONNAIRE', 'ADMIN'));

-- can_manage perd sa branche par équipe : plus personne ne gère une seule
-- équipe. Le paramètre « team » survit à sa raison d'être — une trentaine de
-- policies l'appellent avec deux arguments, et changer la signature voudrait
-- dire toutes les réécrire. Il est ignoré, délibérément.
create or replace function private.can_manage(org uuid, team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m
     where m.organization_id = org and m.user_id = auth.uid() and m.active
       and m.role in ('GESTIONNAIRE', 'ADMIN')
  );
$$;

create or replace function private.can_send(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m
     where m.organization_id = org and m.user_id = auth.uid() and m.active
       and m.role in ('GESTIONNAIRE', 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Le grade et la fonction, séparés.
-- ---------------------------------------------------------------------------

-- Deux choses distinctes qu'une seule colonne confondait : le grade se gagne à
-- l'ancienneté et suit la personne, la fonction se tient sur un engin et peut
-- changer d'une garde à l'autre.
--
-- Ni l'une ni l'autre n'est contrainte à une liste en base. La liste des grades
-- est fermée aujourd'hui et pourrait ne plus l'être, celle des fonctions n'est
-- pas encore arrêtée ; une contrainte « check » rendrait chaque ajout dépendant
-- d'une migration. C'est l'écran qui propose le choix, la base qui accepte le
-- texte — comme elle le fait déjà pour le grade depuis 0004.
alter table public.profiles
  add column fonction text check (fonction is null or length(fonction) between 1 and 60);
alter table public.invitations
  add column fonction text check (fonction is null or length(fonction) between 1 and 60);

grant update (fonction) on public.profiles to authenticated;
grant update (fonction) on public.invitations to authenticated;

-- accept_invitation recopie la fiche de l'invitation vers le profil. Sans cette
-- reprise, la fonction saisie à l'invitation serait perdue au rattachement.
create or replace function private.accept_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations;
begin
  select * into invitation from public.invitations
   where email = lower(btrim(new.email)) and accepted_at is null
   order by created_at limit 1;
  if invitation.id is null then return new; end if;

  insert into public.profiles (user_id, display_name, grade, fonction, matricule, phone)
    values (new.id, invitation.display_name, invitation.grade, invitation.fonction,
            invitation.matricule, invitation.phone)
    on conflict (user_id) do nothing;
  insert into public.memberships (organization_id, user_id, team_id, role, active)
    values (invitation.organization_id, new.id, invitation.team_id, invitation.role, true)
    on conflict (organization_id, user_id) do nothing;
  update public.invitations set accepted_at = now(), accepted_by = new.id where id = invitation.id;
  return new;
end;
$$;

commit;
