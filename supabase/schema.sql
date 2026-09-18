-- Reviewed bootstrap schema for a NEW, dedicated Supabase development project.
-- Not deployed. Tested with PostgreSQL via PGlite (auth schema emulated in tests).
-- Convert to a CLI-generated migration when the development project is selected.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/Paris' check (timezone = 'Europe/Paris'),
  day_start smallint not null default 8 check (day_start between 0 and 22),
  night_start smallint not null default 20 check (night_start between 1 and 23),
  check (day_start < night_start)
);
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(display_name) between 1 and 100)
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  unique (organization_id, id)
);
create index teams_org_idx on public.teams(organization_id);
create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  team_id uuid not null,
  role text not null check (role in ('AGENT', 'RESPONSABLE', 'GESTIONNAIRE', 'ADMIN')),
  active boolean not null default true,
  primary key (organization_id, user_id),
  foreign key (organization_id, team_id) references public.teams(organization_id, id) on delete restrict
);
create index memberships_user_idx on public.memberships(user_id, organization_id);
create index memberships_team_idx on public.memberships(organization_id, team_id);

-- These narrow helpers need a definer to read memberships without recursive RLS.
-- They never accept a user ID; authorization always uses the authenticated subject.
-- private is not an exposed API schema; only authenticated can execute these helpers.
create function private.is_member(org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m where m.organization_id = org and m.user_id = auth.uid() and m.active
  );
$$;
create function private.can_manage(org uuid, team uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m where m.organization_id = org and m.user_id = auth.uid() and m.active
      and (m.role in ('GESTIONNAIRE', 'ADMIN') or (m.role = 'RESPONSABLE' and m.team_id = team))
  );
$$;
revoke all on function private.is_member(uuid), private.can_manage(uuid,uuid) from public;
grant execute on function private.is_member(uuid), private.can_manage(uuid,uuid) to authenticated;

create table public.availability_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  team_id uuid not null,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  locked boolean not null default false,
  day_start smallint not null default 8,
  night_start smallint not null default 20,
  unique (organization_id, id),
  foreign key (organization_id, team_id) references public.teams(organization_id, id),
  check (ends_on >= starts_on),
  check (closes_at > opens_at),
  check (day_start >= 0 and day_start < night_start and night_start < 24)
);
create index campaigns_team_idx on public.availability_campaigns(organization_id, team_id, starts_on);
create table public.campaign_participants (
  organization_id uuid not null,
  campaign_id uuid not null,
  user_id uuid not null,
  validated_at timestamptz,
  primary key (campaign_id, user_id),
  foreign key (organization_id, campaign_id) references public.availability_campaigns(organization_id, id),
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id)
);
create index participants_user_idx on public.campaign_participants(user_id, campaign_id);
create index participants_org_idx on public.campaign_participants(organization_id, user_id);
create table public.availability_entries (
  campaign_id uuid not null,
  user_id uuid not null,
  date date not null,
  availability_type text not null check (availability_type in ('DAY','NIGHT','FULL_24H','UNAVAILABLE')),
  comment text not null default '' check (length(comment) <= 500),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, user_id, date),
  foreign key (campaign_id, user_id) references public.campaign_participants(campaign_id, user_id)
);
create index availability_user_idx on public.availability_entries(user_id, campaign_id);
create index availability_campaign_date_idx on public.availability_entries(campaign_id, date);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.memberships enable row level security;
alter table public.availability_campaigns enable row level security;
alter table public.campaign_participants enable row level security;
alter table public.availability_entries enable row level security;

create policy organization_read on public.organizations for select to authenticated using (private.is_member(id));
create policy profile_own_read on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profile_team_read on public.profiles for select to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = profiles.user_id and m.active and private.can_manage(m.organization_id, m.team_id))
);
create policy team_read on public.teams for select to authenticated using (private.is_member(organization_id));
create policy membership_read on public.memberships for select to authenticated using (
  (user_id = (select auth.uid()) and active) or private.can_manage(organization_id, team_id)
);
create policy campaign_read on public.availability_campaigns for select to authenticated using (private.is_member(organization_id));
create policy campaign_insert on public.availability_campaigns for insert to authenticated with check (private.can_manage(organization_id, team_id));
-- Freeze dates/hours/ownership after creation. Only the lock flag is client-updatable.
create policy campaign_lock on public.availability_campaigns for update to authenticated using (private.can_manage(organization_id, team_id)) with check (private.can_manage(organization_id, team_id));
create policy participant_read on public.campaign_participants for select to authenticated using (
  (user_id = (select auth.uid()) and private.is_member(organization_id)) or exists (
    select 1 from public.availability_campaigns c where c.id = campaign_id and private.can_manage(c.organization_id, c.team_id)
  )
);
create policy participant_insert on public.campaign_participants for insert to authenticated with check (
  validated_at is null and exists (
    select 1 from public.availability_campaigns c
    join public.memberships m on m.organization_id = c.organization_id and m.team_id = c.team_id
    where c.id = campaign_id and m.user_id = campaign_participants.user_id and m.active and private.can_manage(c.organization_id, c.team_id)
  )
);
create policy participant_validate on public.campaign_participants for update to authenticated using (
  user_id = (select auth.uid()) and private.is_member(organization_id)
) with check (user_id = (select auth.uid()) and private.is_member(organization_id));
create policy entries_read on public.availability_entries for select to authenticated using (
  exists (select 1 from public.campaign_participants p where p.campaign_id = availability_entries.campaign_id and p.user_id = availability_entries.user_id)
);
create policy entries_insert on public.availability_entries for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.campaign_participants p where p.campaign_id = availability_entries.campaign_id and p.user_id = (select auth.uid()))
);
create policy entries_update on public.availability_entries for update to authenticated using (
  user_id = (select auth.uid()) and exists (select 1 from public.campaign_participants p where p.campaign_id = availability_entries.campaign_id and p.user_id = (select auth.uid()))
) with check (user_id = (select auth.uid()));
create policy entries_delete on public.availability_entries for delete to authenticated using (
  user_id = (select auth.uid()) and exists (select 1 from public.campaign_participants p where p.campaign_id = availability_entries.campaign_id and p.user_id = (select auth.uid()))
);

-- Serialize writes and validation through the same participant row lock.
create function private.check_availability_write() returns trigger language plpgsql security invoker set search_path = '' as $$
declare c public.availability_campaigns; entry_campaign uuid; entry_user uuid; entry_date date;
begin
  if TG_OP = 'UPDATE' and (new.campaign_id, new.user_id, new.date) is distinct from (old.campaign_id, old.user_id, old.date) then
    raise exception 'Availability identity is immutable';
  end if;
  if TG_OP = 'DELETE' then entry_campaign := old.campaign_id; entry_user := old.user_id; entry_date := old.date;
  else entry_campaign := new.campaign_id; entry_user := new.user_id; entry_date := new.date; end if;
  select * into c from public.availability_campaigns where id = entry_campaign;
  if c.id is null or c.locked or now() < c.opens_at or now() > c.closes_at then raise exception 'Campaign is closed'; end if;
  if entry_date < c.starts_on or entry_date > c.ends_on then raise exception 'Date outside campaign'; end if;
  perform 1 from public.campaign_participants where campaign_id = entry_campaign and user_id = entry_user for update;
  update public.campaign_participants set validated_at = null where campaign_id = entry_campaign and user_id = entry_user;
  if TG_OP = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger availability_write before insert or update or delete on public.availability_entries for each row execute function private.check_availability_write();

create function private.check_validation() returns trigger language plpgsql security invoker set search_path = '' as $$
declare c public.availability_campaigns; filled bigint;
begin
  if new.validated_at is not null then
    select * into c from public.availability_campaigns where id = new.campaign_id;
    if c.id is null or c.locked or now() < c.opens_at or now() > c.closes_at then raise exception 'Campaign is closed'; end if;
    select count(*) into filled from public.availability_entries where campaign_id = new.campaign_id and user_id = new.user_id;
    if filled <> c.ends_on - c.starts_on + 1 then raise exception 'Complete all dates before validation'; end if;
    new.validated_at := now();
  end if;
  return new;
end;
$$;
create trigger response_validation before update of validated_at on public.campaign_participants for each row execute function private.check_validation();
revoke all on function private.check_availability_write(), private.check_validation() from public;

-- Explicit grants, independent from default privileges on the target project.
revoke all on public.organizations, public.profiles, public.teams, public.memberships, public.availability_campaigns, public.campaign_participants, public.availability_entries from anon, authenticated;
grant select on public.organizations, public.profiles, public.teams, public.memberships, public.availability_campaigns, public.campaign_participants, public.availability_entries to authenticated;
grant insert on public.availability_campaigns, public.campaign_participants to authenticated;
grant update (locked) on public.availability_campaigns to authenticated;
grant update (validated_at) on public.campaign_participants to authenticated;
grant insert, delete on public.availability_entries to authenticated;
grant update (availability_type, comment) on public.availability_entries to authenticated;
-- Organization/user/team provisioning and role changes are intentionally not
-- available through the client API in this first foundation.
commit;
