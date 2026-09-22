-- Trois correctifs issus de l'analyse du 22 septembre 2026 (B2, B5, B6).
--
-- 1. Un agent désactivé ne pouvait plus être réactivé depuis l'application :
--    les deux policies qui ouvrent sa fiche à l'encadrement exigeaient un
--    rattachement actif. Sa fiche n'était donc ni lisible — il apparaissait
--    sous le nom « Agent » dans la liste des inactifs — ni modifiable, et la
--    commande s'arrêtait avant d'atteindre le rattachement. Reproduit.
--
-- 2. Un gestionnaire pouvait désactiver le dernier administrateur du centre.
--    Plus personne ne pouvait alors changer un rôle ni inviter un
--    administrateur : le centre était verrouillé jusqu'à l'éditeur SQL.
--    Reproduit.
--
-- 3. Un agent pouvait retirer sa validation après la clôture de la campagne,
--    sans qu'aucune trace n'en reste : le contrôle de fenêtre ne portait que
--    sur le sens de la validation. Un créneau publié qui le retenait ne pouvait
--    plus être republié — « Every assignment needs a validated matching
--    availability » — sans que le gestionnaire sache pourquoi. Reproduit.
--
-- S'applique par-dessus 20260921140000. À coller en entier.
begin;

do $$
begin
  if to_regproc('public.register_push_subscription') is null then
    raise exception 'Appliquez d''abord 20260921130000_web_push_abonnement.sql';
  end if;
  if to_regproc('private.active_administrators') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. La fiche d'un membre désactivé reste celle de l'encadrement.
-- ---------------------------------------------------------------------------
--
-- Le rattachement dit qui est actif ; la fiche, elle, ne change pas de main
-- parce qu'on la met en sommeil. Un gestionnaire doit pouvoir voir qui il a
-- désactivé, et le faire revenir. Les deux policies perdent donc « m.active ».
-- Le périmètre reste le centre : can_manage() et can_administer() répondent
-- pour l'organisation du rattachement, et ne connaissent pas les autres.

drop policy profile_team_read on public.profiles;
create policy profile_team_read on public.profiles for select to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = profiles.user_id and private.can_manage(m.organization_id, m.team_id))
);

drop policy profile_admin_write on public.profiles;
create policy profile_admin_write on public.profiles for update to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and private.can_administer(m.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and private.can_administer(m.organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Un administrateur ne se retire que par un administrateur, et jamais le
--    dernier.
-- ---------------------------------------------------------------------------
--
-- « security definer » : le déclencheur qui l'appelle est en « invoker », et
-- compter les administrateurs sous les policies de l'appelant donnerait un
-- résultat qui dépend de qui regarde.

create function private.active_administrators(org uuid) returns integer
language sql security definer stable set search_path = '' as $$
  select count(*)::integer from public.memberships
   where organization_id = org and role = 'ADMIN' and active;
$$;
revoke all on function private.active_administrators(uuid) from public;
-- Appelée depuis un déclencheur « invoker » : la session doit pouvoir l'exécuter,
-- comme is_administrator(). Le schéma private reste hors de portée de PostgREST.
grant execute on function private.active_administrators(uuid) to authenticated;

create or replace function private.check_membership_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    if new.user_id = auth.uid() then raise exception 'Cannot change your own role'; end if;
    if not private.is_administrator(new.organization_id) then
      raise exception 'Only an administrator can change a role';
    end if;
  end if;
  if new.active is distinct from old.active and new.user_id = auth.uid() then
    raise exception 'Cannot deactivate your own account';
  end if;
  -- Désactiver ou rétrograder un administrateur est un geste d'administrateur.
  -- Le changement de rôle l'est déjà par la règle ci-dessus ; la désactivation
  -- ne demandait que le droit d'administrer, qu'un gestionnaire possède.
  if old.role = 'ADMIN' and old.active and (not new.active or new.role <> 'ADMIN') then
    if not private.is_administrator(new.organization_id) then
      raise exception 'Only an administrator can deactivate an administrator';
    end if;
    -- Et jamais le dernier : sans administrateur actif, plus personne ne peut
    -- changer un rôle ni en inviter un — le centre est verrouillé.
    if private.active_administrators(new.organization_id) <= 1 then
      raise exception 'Cannot remove the last administrator';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Retirer sa validation obéit à la même fenêtre que la donner.
-- ---------------------------------------------------------------------------
--
-- Deux chemins mènent à validated_at = null. Le premier est la conséquence
-- d'une saisie : check_availability_write() a déjà vérifié la fenêtre et
-- l'audit enregistre la saisie elle-même. Le second est direct — l'agent, ou
-- un script muni de son jeton — et n'était contrôlé par rien. pg_trigger_depth()
-- distingue les deux : la conséquence d'une saisie arrive à la profondeur 2.

create or replace function private.check_validation() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare c public.availability_campaigns; filled bigint;
begin
  if new.validated_at is not null then
    select * into c from public.availability_campaigns where id = new.campaign_id;
    if c.id is null or c.locked or now() < c.opens_at or now() > c.closes_at then raise exception 'Campaign is closed'; end if;
    select count(*) into filled from public.availability_entries where campaign_id = new.campaign_id and user_id = new.user_id;
    if filled <> c.ends_on - c.starts_on + 1 then raise exception 'Complete all dates before validation'; end if;
    new.validated_at := now();
  elsif old.validated_at is not null and pg_trigger_depth() = 1 then
    select * into c from public.availability_campaigns where id = new.campaign_id;
    if c.id is null or c.locked or now() < c.opens_at or now() > c.closes_at then raise exception 'Campaign is closed'; end if;
  end if;
  return new;
end;
$$;

-- Une dévalidation directe est un acte, et le journal doit le porter. Celle
-- qui découle d'une saisie est déjà représentée par la saisie ; record_audit()
-- l'écarte, et c'est ce qui justifie ce second déclencheur plutôt qu'une
-- reprise du premier.
create function private.record_unvalidation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.validated_at is null or new.validated_at is not null or pg_trigger_depth() > 1 then return null; end if;
  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (new.organization_id, auth.uid(), 'campaign_participant',
            concat_ws('/', new.campaign_id, new.user_id), 'UNVALIDATE', to_jsonb(old), to_jsonb(new));
  return null;
end;
$$;
revoke all on function private.record_unvalidation() from public;
create trigger audit_unvalidation after update of validated_at on public.campaign_participants
  for each row execute function private.record_unvalidation();

commit;
