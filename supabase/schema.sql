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

-- ---------------------------------------------------------------------------
-- Qualifications, needs, planning, notifications and audit.
-- Every table carries organization_id and joins through composite keys so a row
-- can never be attached to another organization's parent.
-- ---------------------------------------------------------------------------

create table public.qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(name) between 1 and 60),
  unique (organization_id, id),
  unique (organization_id, name)
);
create index qualifications_org_idx on public.qualifications(organization_id);

create table public.user_qualifications (
  organization_id uuid not null,
  user_id uuid not null,
  qualification_id uuid not null,
  obtained_on date,
  primary key (user_id, qualification_id),
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete restrict,
  foreign key (organization_id, qualification_id) references public.qualifications(organization_id, id) on delete restrict
);
create index user_qualifications_qualification_idx on public.user_qualifications(organization_id, qualification_id);

-- The organization default. A campaign freezes its own hours at creation, so
-- changing these never moves availabilities already collected.
create table public.shift_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check (code in ('DAY', 'NIGHT')),
  starts_at_hour smallint not null check (starts_at_hour between 0 and 23),
  duration_hours smallint not null check (duration_hours between 1 and 24),
  unique (organization_id, id),
  unique (organization_id, code)
);

create table public.staffing_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id uuid not null,
  date date not null,
  shift_code text not null check (shift_code in ('DAY', 'NIGHT')),
  headcount smallint not null check (headcount between 1 and 100),
  unique (campaign_id, date, shift_code),
  unique (organization_id, id),
  foreign key (organization_id, campaign_id) references public.availability_campaigns(organization_id, id) on delete restrict
);
create index staffing_requirements_campaign_idx on public.staffing_requirements(campaign_id, date);

-- Headcount and qualifications are two separate measures: reaching the total
-- never proves the required qualifications are present.
create table public.staffing_requirement_qualifications (
  organization_id uuid not null,
  requirement_id uuid not null,
  qualification_id uuid not null,
  minimum smallint not null check (minimum >= 0),
  primary key (requirement_id, qualification_id),
  foreign key (organization_id, requirement_id) references public.staffing_requirements(organization_id, id) on delete cascade,
  foreign key (organization_id, qualification_id) references public.qualifications(organization_id, id) on delete restrict
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id uuid not null,
  team_id uuid not null,
  created_at timestamptz not null default now(),
  unique (campaign_id),
  unique (organization_id, id),
  foreign key (organization_id, campaign_id) references public.availability_campaigns(organization_id, id) on delete restrict,
  foreign key (organization_id, team_id) references public.teams(organization_id, id) on delete restrict
);

create table public.schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  schedule_id uuid not null,
  date date not null,
  shift_code text not null check (shift_code in ('DAY', 'NIGHT')),
  published_revision integer not null default 0 check (published_revision >= 0),
  published_at timestamptz,
  unique (schedule_id, date, shift_code),
  unique (organization_id, id),
  foreign key (organization_id, schedule_id) references public.schedules(organization_id, id) on delete restrict,
  check ((published_revision = 0) = (published_at is null))
);
create index schedule_shifts_date_idx on public.schedule_shifts(schedule_id, date);

-- Revision 0 is the draft the manager edits. Each publication copies it to the
-- next revision, which is then never touched again: changing the draft does not
-- move what agents already see.
create table public.schedule_assignments (
  organization_id uuid not null,
  schedule_shift_id uuid not null,
  user_id uuid not null,
  revision integer not null default 0 check (revision >= 0),
  status text not null default 'PROPOSED' check (status in ('PROPOSED', 'CONFIRMED', 'CANCELLED', 'SWAP_REQUESTED')),
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (schedule_shift_id, user_id, revision),
  foreign key (organization_id, schedule_shift_id) references public.schedule_shifts(organization_id, id) on delete restrict,
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete restrict,
  foreign key (organization_id, assigned_by) references public.memberships(organization_id, user_id) on delete restrict
);
create index schedule_assignments_user_idx on public.schedule_assignments(user_id, revision);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('CAMPAIGN_OPENED', 'CAMPAIGN_REMINDER', 'SCHEDULE_PUBLISHED')),
  subject text not null check (length(subject) between 1 and 200),
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete restrict
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- Old and new values are required by the specification, not just the action.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  entity text not null,
  entity_id text not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs(organization_id, occurred_at desc);

alter table public.qualifications enable row level security;
alter table public.user_qualifications enable row level security;
alter table public.shift_types enable row level security;
alter table public.staffing_requirements enable row level security;
alter table public.staffing_requirement_qualifications enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_shifts enable row level security;
alter table public.schedule_assignments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy qualification_read on public.qualifications for select to authenticated using (private.is_member(organization_id));
create policy user_qualification_read on public.user_qualifications for select to authenticated using (private.is_member(organization_id));
create policy shift_type_read on public.shift_types for select to authenticated using (private.is_member(organization_id));

create policy requirement_read on public.staffing_requirements for select to authenticated using (private.is_member(organization_id));
create policy requirement_write on public.staffing_requirements for all to authenticated using (
  exists (select 1 from public.availability_campaigns c where c.id = campaign_id and private.can_manage(c.organization_id, c.team_id))
) with check (
  exists (select 1 from public.availability_campaigns c where c.id = campaign_id and private.can_manage(c.organization_id, c.team_id))
);
create policy requirement_qualification_read on public.staffing_requirement_qualifications for select to authenticated using (
  private.is_member(organization_id)
);
create policy requirement_qualification_write on public.staffing_requirement_qualifications for all to authenticated using (
  exists (
    select 1 from public.staffing_requirements r
    join public.availability_campaigns c on c.id = r.campaign_id
    where r.id = requirement_id and private.can_manage(c.organization_id, c.team_id)
  )
) with check (
  exists (
    select 1 from public.staffing_requirements r
    join public.availability_campaigns c on c.id = r.campaign_id
    where r.id = requirement_id and private.can_manage(c.organization_id, c.team_id)
  )
);

create policy schedule_read on public.schedules for select to authenticated using (private.is_member(organization_id));
create policy schedule_insert on public.schedules for insert to authenticated with check (private.can_manage(organization_id, team_id));
create policy schedule_shift_read on public.schedule_shifts for select to authenticated using (private.is_member(organization_id));
create policy schedule_shift_insert on public.schedule_shifts for insert to authenticated with check (
  exists (select 1 from public.schedules s where s.id = schedule_id and private.can_manage(s.organization_id, s.team_id))
);

-- An agent sees only the published version of their own shifts; drafts belong to
-- the manager. Published revisions are written by the publication function only,
-- which runs as owner and therefore bypasses these policies.
create policy assignment_read on public.schedule_assignments for select to authenticated using (
  (
    user_id = (select auth.uid())
    and revision > 0
    and exists (select 1 from public.schedule_shifts s where s.id = schedule_shift_id and s.published_revision = revision)
  )
  or exists (
    select 1 from public.schedule_shifts s
    join public.schedules sc on sc.id = s.schedule_id
    where s.id = schedule_shift_id and private.can_manage(sc.organization_id, sc.team_id)
  )
);
create policy assignment_draft_write on public.schedule_assignments for insert to authenticated with check (
  revision = 0
  and exists (
    select 1 from public.schedule_shifts s
    join public.schedules sc on sc.id = s.schedule_id
    where s.id = schedule_shift_id and private.can_manage(sc.organization_id, sc.team_id)
  )
);
create policy assignment_draft_delete on public.schedule_assignments for delete to authenticated using (
  revision = 0
  and exists (
    select 1 from public.schedule_shifts s
    join public.schedules sc on sc.id = s.schedule_id
    where s.id = schedule_shift_id and private.can_manage(sc.organization_id, sc.team_id)
  )
);

create policy notification_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notification_mark_read on public.notifications for update to authenticated using (
  user_id = (select auth.uid())
) with check (user_id = (select auth.uid()));
create policy audit_read on public.audit_logs for select to authenticated using (
  exists (
    select 1 from public.memberships m
    where m.organization_id = audit_logs.organization_id and m.user_id = (select auth.uid()) and m.active
      and m.role in ('GESTIONNAIRE', 'ADMIN')
  )
);

-- A qualification minimum above the headcount can never be satisfied.
create function private.check_requirement_minimum() returns trigger language plpgsql security invoker set search_path = '' as $$
declare allowed smallint;
begin
  select headcount into allowed from public.staffing_requirements where id = new.requirement_id;
  if allowed is null or new.minimum > allowed then
    raise exception 'Qualification minimum exceeds the required headcount';
  end if;
  return new;
end;
$$;
create trigger requirement_minimum before insert or update on public.staffing_requirement_qualifications
  for each row execute function private.check_requirement_minimum();

-- Publication is a single server transaction: it re-checks headcount,
-- qualifications and the eligibility of every agent, then freezes a revision.
create function private.publish_schedule_shift(shift uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  sch public.schedules;
  req public.staffing_requirements;
  campaign uuid;
  retained integer;
  missing text;
  next_revision integer;
begin
  select * into s from public.schedule_shifts where id = shift;
  if s.id is null then raise exception 'Unknown shift'; end if;
  select * into sch from public.schedules where id = s.schedule_id;
  if not private.can_manage(sch.organization_id, sch.team_id) then
    raise exception 'Not allowed to publish this schedule';
  end if;
  campaign := sch.campaign_id;

  select count(*) into retained from public.schedule_assignments a
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED';

  -- Never derive an assignment from an availability: check they still agree.
  if exists (
    select 1 from public.schedule_assignments a
     where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
       and not exists (
         select 1 from public.availability_entries e
         join public.campaign_participants p on p.campaign_id = e.campaign_id and p.user_id = e.user_id
         where e.campaign_id = campaign and e.user_id = a.user_id and e.date = s.date
           and p.validated_at is not null
           and e.availability_type in (s.shift_code, 'FULL_24H')
       )
  ) then
    raise exception 'Every assignment needs a validated matching availability';
  end if;

  select * into req from public.staffing_requirements
   where campaign_id = campaign and date = s.date and shift_code = s.shift_code;
  if req.id is null then raise exception 'Define the staffing requirement before publishing'; end if;
  if retained < req.headcount then
    raise exception 'Headcount not covered: % of %', retained, req.headcount;
  end if;

  select string_agg(q.name, ', ') into missing
    from public.staffing_requirement_qualifications rq
    join public.qualifications q on q.id = rq.qualification_id
   where rq.requirement_id = req.id
     and rq.minimum > (
       select count(*) from public.schedule_assignments a
       join public.user_qualifications uq on uq.user_id = a.user_id and uq.qualification_id = rq.qualification_id
       where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     );
  if missing is not null then raise exception 'Qualifications not covered: %', missing; end if;

  next_revision := s.published_revision + 1;
  insert into public.schedule_assignments (organization_id, schedule_shift_id, user_id, revision, status, assigned_by, assigned_at)
    select a.organization_id, a.schedule_shift_id, a.user_id, next_revision, 'CONFIRMED', a.assigned_by, now()
      from public.schedule_assignments a
     where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED';
  update public.schedule_shifts set published_revision = next_revision, published_at = now() where id = shift;

  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (sch.organization_id, auth.uid(), 'schedule_shift', shift::text, 'PUBLISH',
            jsonb_build_object('revision', s.published_revision),
            jsonb_build_object('revision', next_revision, 'headcount', retained));

  insert into public.notifications (organization_id, user_id, kind, subject)
    select sch.organization_id, a.user_id, 'SCHEDULE_PUBLISHED', 'Votre planning a été publié'
      from public.schedule_assignments a
     where a.schedule_shift_id = shift and a.revision = next_revision;

  return next_revision;
end;
$$;
revoke all on function private.check_requirement_minimum(), private.publish_schedule_shift(uuid) from public;
grant execute on function private.publish_schedule_shift(uuid) to authenticated;

-- Explicit grants, independent from default privileges on the target project.
revoke all on public.organizations, public.profiles, public.teams, public.memberships, public.availability_campaigns, public.campaign_participants, public.availability_entries from anon, authenticated;
grant select on public.organizations, public.profiles, public.teams, public.memberships, public.availability_campaigns, public.campaign_participants, public.availability_entries to authenticated;
grant insert on public.availability_campaigns, public.campaign_participants to authenticated;
grant update (locked) on public.availability_campaigns to authenticated;
grant update (validated_at) on public.campaign_participants to authenticated;
grant insert, delete on public.availability_entries to authenticated;
grant update (availability_type, comment) on public.availability_entries to authenticated;

revoke all on public.qualifications, public.user_qualifications, public.shift_types, public.staffing_requirements, public.staffing_requirement_qualifications, public.schedules, public.schedule_shifts, public.schedule_assignments, public.notifications, public.audit_logs from anon, authenticated;
grant select on public.qualifications, public.user_qualifications, public.shift_types, public.staffing_requirements, public.staffing_requirement_qualifications, public.schedules, public.schedule_shifts, public.schedule_assignments, public.notifications, public.audit_logs to authenticated;
grant insert, delete on public.staffing_requirements, public.staffing_requirement_qualifications to authenticated;
grant update (headcount) on public.staffing_requirements to authenticated;
grant update (minimum) on public.staffing_requirement_qualifications to authenticated;
grant insert on public.schedules, public.schedule_shifts to authenticated;
grant insert, delete on public.schedule_assignments to authenticated;
grant update (read_at) on public.notifications to authenticated;
-- Published revisions, publication state and audit rows are never written from a
-- client session: private.publish_schedule_shift() runs as owner and does it.
-- Organization/user/team provisioning, the qualification catalogue and role
-- changes are intentionally not available through the client API either.
commit;
