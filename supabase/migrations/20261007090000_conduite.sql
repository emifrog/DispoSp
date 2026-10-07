-- La conduite d'un agent : Aucun, COD SSR, PL, COD2 ou COD6.
--
-- Une seule par agent — la plus haute qu'il détient —, et exigible : on doit
-- pouvoir demander « au moins un COD2 sur la garde de nuit ». C'est donc une
-- qualification, dans le catalogue du centre comme les autres : les besoins, la
-- couverture et le contrôle de publication la comptent sans rien changer à leurs
-- règles. Ce qui s'ajoute ici :
--
-- 1. l'invitation la porte, puisqu'elle se saisit à l'invitation, sous la
--    fonction ;
-- 2. elle devient une qualification de l'agent le jour où il rejoint le centre,
--    par l'un ou l'autre des deux chemins — confirmation d'un compte neuf, ou
--    rattachement immédiat d'un compte existant ;
-- 3. la base refuse qu'un agent en tienne deux.
--
-- « Aucun » n'est pas une valeur : c'est l'absence de conduite.
--
-- S'applique par-dessus 20261005120000. À coller en entier, **avant** de
-- déployer le code qui l'accompagne : l'invitation écrit la colonne `conduite`.
begin;

do $$
begin
  if to_regproc('public.release_email_delivery') is null then
    raise exception 'Appliquez d''abord 20261005120000_suspension_file_email.sql';
  end if;
  if to_regproc('private.is_conduite') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- La liste, en un seul endroit pour les déclencheurs. La contrainte de la
-- colonne la répète : une contrainte ne doit dépendre que d'expressions fixes.
create function private.is_conduite(name text) returns boolean
language sql immutable set search_path = '' as $$
  select name in ('COD SSR', 'PL', 'COD2', 'COD6');
$$;
-- Appelée seulement par les deux fonctions « security definer » plus bas.
revoke all on function private.is_conduite(text) from public, anon, authenticated;

-- 1. L'invitation porte la conduite. L'insertion est déjà ouverte à
--    l'encadrement sur toute la ligne (0004) ; les policies et le déclencheur
--    des invitations s'appliquent comme avant.
alter table public.invitations
  add column conduite text check (conduite is null or conduite in ('COD SSR', 'PL', 'COD2', 'COD6'));

-- 3. Une conduite par agent et par centre. Avant l'insertion : save_member()
--    retire d'abord ce qui n'est plus coché, puis ajoute — passer de PL à COD2
--    d'un même geste passe donc.
create function private.check_single_conduite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.qualifications q
     where q.id = new.qualification_id and private.is_conduite(q.name)
  ) and exists (
    select 1 from public.user_qualifications uq
      join public.qualifications q on q.id = uq.qualification_id
     where uq.organization_id = new.organization_id and uq.user_id = new.user_id
       and uq.qualification_id <> new.qualification_id and private.is_conduite(q.name)
  ) then
    raise exception 'Only one driving qualification per agent';
  end if;
  return new;
end;
$$;
revoke all on function private.check_single_conduite() from public, anon, authenticated;
create trigger single_conduite before insert on public.user_qualifications
  for each row execute function private.check_single_conduite();

-- 2. Le rattachement. Les deux chemins finissent par la même écriture :
--    l'invitation marquée acceptée, au nom de l'agent. C'est là qu'on accroche,
--    plutôt que de reprendre les deux fonctions qui rattachent.
--
--    Une réinvitation — un agent retiré puis réinvité — remplace la conduite
--    qu'il tenait dans ce centre : il n'en tient qu'une, et l'invitation est la
--    plus récente. Sans conduite à l'invitation, on ne retire rien.
--
--    « security definer » : à la confirmation d'un compte neuf, il n'y a pas de
--    session ; le rattachement lui-même a déjà passé ses contrôles.
create function private.qualify_accepted_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare qualification uuid;
begin
  if new.conduite is null or new.accepted_by is null
     or old.accepted_at is not null or new.accepted_at is null then
    return null;
  end if;
  insert into public.qualifications (organization_id, name) values (new.organization_id, new.conduite)
    on conflict (organization_id, name) do nothing;
  select q.id into qualification from public.qualifications q
   where q.organization_id = new.organization_id and q.name = new.conduite;
  delete from public.user_qualifications uq
   using public.qualifications q
   where q.id = uq.qualification_id
     and uq.organization_id = new.organization_id and uq.user_id = new.accepted_by
     and private.is_conduite(q.name) and q.id <> qualification;
  insert into public.user_qualifications (organization_id, user_id, qualification_id)
    values (new.organization_id, new.accepted_by, qualification)
    on conflict (user_id, qualification_id) do nothing;
  return null;
end;
$$;
revoke all on function private.qualify_accepted_invitation() from public, anon, authenticated;
create trigger qualify_accepted_invitation after update of accepted_at on public.invitations
  for each row execute function private.qualify_accepted_invitation();

commit;
