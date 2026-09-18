-- 0004 — Fiche agent, invitations, administration des équipes et qualifications.
-- Applies on top of 0003_client_writes.sql. Not re-runnable: it creates objects.
-- Paste it whole; the transaction below rolls the migration back on any error.
begin;

do $$
begin
  if to_regproc('public.publish_shift') is null then
    raise exception 'Apply 0003_client_writes.sql first: public.publish_shift is missing';
  end if;
  if to_regclass('public.invitations') is not null then
    raise exception '0004 has already been applied to this database';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The agent record required by §3.
-- ---------------------------------------------------------------------------

-- Carried by the person rather than by the centre, as decided. The consequence
-- is deliberate and worth naming: profiles holds no organization, so no unique
-- constraint can scope a matricule to one centre.
alter table public.profiles
  add column grade text check (grade is null or length(grade) between 1 and 60),
  add column matricule text check (matricule is null or length(matricule) between 1 and 30),
  add column phone text check (phone is null or length(phone) between 1 and 30);

create function private.is_administrator(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m
     where m.organization_id = org and m.user_id = auth.uid() and m.active and m.role = 'ADMIN'
  );
$$;
revoke all on function private.is_administrator(uuid) from public;
grant execute on function private.is_administrator(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Invitations: the one door through which an account joins a centre.
-- ---------------------------------------------------------------------------

-- No service key anywhere in this project. An administrator records who is
-- expected; the agent creates their own account with their own password, and the
-- trigger below does the attaching. Provisioning stays out of the client API.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  team_id uuid not null,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1 and length(email) <= 200),
  display_name text not null check (length(display_name) between 1 and 100),
  role text not null check (role in ('AGENT', 'RESPONSABLE', 'GESTIONNAIRE', 'ADMIN')),
  grade text check (grade is null or length(grade) between 1 and 60),
  matricule text check (matricule is null or length(matricule) between 1 and 30),
  phone text check (phone is null or length(phone) between 1 and 30),
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  unique (organization_id, email),
  check ((accepted_at is null) = (accepted_by is null)),
  foreign key (organization_id, team_id) references public.teams(organization_id, id) on delete restrict,
  foreign key (organization_id, invited_by) references public.memberships(organization_id, user_id) on delete restrict
);
create index invitations_email_idx on public.invitations(email) where accepted_at is null;

-- Fires once the address is confirmed, not at sign-up: an unconfirmed account
-- never takes a seat in a centre.
create function private.accept_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations;
begin
  select * into invitation from public.invitations
   where email = lower(btrim(new.email)) and accepted_at is null
   order by created_at limit 1;
  if invitation.id is null then return new; end if;

  insert into public.profiles (user_id, display_name, grade, matricule, phone)
    values (new.id, invitation.display_name, invitation.grade, invitation.matricule, invitation.phone)
    on conflict (user_id) do nothing;
  insert into public.memberships (organization_id, user_id, team_id, role, active)
    values (invitation.organization_id, new.id, invitation.team_id, invitation.role, true)
    on conflict (organization_id, user_id) do nothing;
  update public.invitations set accepted_at = now(), accepted_by = new.id where id = invitation.id;
  return new;
end;
$$;
revoke all on function private.accept_invitation() from public;
create trigger accept_invitation after insert or update of email_confirmed_at on auth.users
  for each row when (new.email_confirmed_at is not null) execute function private.accept_invitation();

alter table public.invitations enable row level security;
create policy invitation_read on public.invitations for select to authenticated
  using (private.can_administer(organization_id));
create policy invitation_write on public.invitations for all to authenticated
  using (private.can_administer(organization_id) and accepted_at is null)
  with check (private.can_administer(organization_id) and accepted_at is null);
revoke all on public.invitations from anon, authenticated;
grant select, insert, delete on public.invitations to authenticated;
grant update (team_id, role, display_name, grade, matricule, phone) on public.invitations to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Administering the people already there.
-- ---------------------------------------------------------------------------

create policy profile_admin_write on public.profiles for update to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and m.active and private.can_administer(m.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and m.active and private.can_administer(m.organization_id)
    )
  );
grant update (display_name, grade, matricule, phone) on public.profiles to authenticated;

create policy membership_write on public.memberships for update to authenticated
  using (private.can_administer(organization_id)) with check (private.can_administer(organization_id));
grant update (team_id, role, active) on public.memberships to authenticated;

-- A column grant cannot tell a role change from a transfer, so the rule that
-- matters lives here: nobody promotes themselves, and only an administrator
-- moves anyone between roles at all.
create function private.check_membership_change() returns trigger
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
  return new;
end;
$$;
revoke all on function private.check_membership_change() from public;
create trigger membership_change before update on public.memberships
  for each row execute function private.check_membership_change();

create policy team_write on public.teams for all to authenticated
  using (private.can_administer(organization_id)) with check (private.can_administer(organization_id));
grant insert on public.teams to authenticated;
grant update (name) on public.teams to authenticated;

create policy user_qualification_write on public.user_qualifications for all to authenticated
  using (private.can_administer(organization_id)) with check (private.can_administer(organization_id));
grant insert, delete on public.user_qualifications to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Audit of the administration itself (§12).
-- ---------------------------------------------------------------------------

-- A separate function rather than a replacement of record_audit(): 0003 keeps
-- its own body, and the two sets of tables stay legible side by side.
create function private.record_admin_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb := case when TG_OP = 'INSERT' then null else to_jsonb(old) end;
  after_row jsonb := case when TG_OP = 'DELETE' then null else to_jsonb(new) end;
  subject jsonb := coalesce(after_row, before_row);
  org uuid;
  actor uuid := auth.uid();
  entity text;
  entity_id text;
  action text;
begin
  case TG_TABLE_NAME
    when 'profiles' then
      entity := 'profile';
      select m.organization_id into org from public.memberships m
       where m.user_id = (subject ->> 'user_id')::uuid and m.active limit 1;
      entity_id := subject ->> 'user_id';
      action := 'UPDATE';
    when 'memberships' then
      entity := 'membership';
      org := (subject ->> 'organization_id')::uuid;
      entity_id := subject ->> 'user_id';
      action := case
        when TG_OP = 'INSERT' then 'JOIN'
        when before_row ->> 'role' is distinct from after_row ->> 'role' then 'ROLE'
        when before_row ->> 'active' is distinct from after_row ->> 'active' then
          case when (after_row ->> 'active')::boolean then 'ACTIVATE' else 'DEACTIVATE' end
        when before_row ->> 'team_id' is distinct from after_row ->> 'team_id' then 'TEAM'
        else null
      end;
    when 'teams' then
      entity := 'team';
      org := (subject ->> 'organization_id')::uuid;
      entity_id := subject ->> 'id';
      action := case when TG_OP = 'INSERT' then 'CREATE' else 'RENAME' end;
    when 'invitations' then
      entity := 'invitation';
      org := (subject ->> 'organization_id')::uuid;
      entity_id := subject ->> 'email';
      action := case
        when TG_OP = 'INSERT' then 'CREATE'
        when TG_OP = 'DELETE' then 'CANCEL'
        when after_row ->> 'accepted_at' is not null and before_row ->> 'accepted_at' is null then 'ACCEPT'
        else 'UPDATE'
      end;
      -- The acceptance is the agent's own act, recorded from a trigger where
      -- auth.uid() is not theirs.
      if action = 'ACCEPT' then actor := (after_row ->> 'accepted_by')::uuid; end if;
    when 'user_qualifications' then
      entity := 'user_qualification';
      org := (subject ->> 'organization_id')::uuid;
      entity_id := concat_ws('/', subject ->> 'user_id', subject ->> 'qualification_id');
      action := case when TG_OP = 'DELETE' then 'REVOKE' else 'GRANT' end;
    else
      return null;
  end case;
  if org is null or action is null then return null; end if;
  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (org, actor, entity, entity_id, action, before_row, after_row);
  return null;
end;
$$;
revoke all on function private.record_admin_audit() from public;

create trigger audit_profiles after update on public.profiles
  for each row execute function private.record_admin_audit();
create trigger audit_memberships after insert or update on public.memberships
  for each row execute function private.record_admin_audit();
create trigger audit_teams after insert or update on public.teams
  for each row execute function private.record_admin_audit();
create trigger audit_invitations after insert or update or delete on public.invitations
  for each row execute function private.record_admin_audit();
create trigger audit_user_qualifications after insert or delete on public.user_qualifications
  for each row execute function private.record_admin_audit();

commit;
