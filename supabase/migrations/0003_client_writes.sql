-- 0003 — What the client still cannot write: publication, default hours, the
-- qualification catalogue, and the audit trail required by §12.
-- Applies on top of 0002_planning.sql. Not re-runnable: it creates objects.
-- Paste it whole; the transaction below rolls the migration back on any error.
begin;

do $$
begin
  if to_regclass('public.schedule_assignments') is null then
    raise exception 'Apply 0002_planning.sql first: public.schedule_assignments is missing';
  end if;
  if to_regproc('public.publish_shift') is not null then
    raise exception '0003 has already been applied to this database';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Managing a centre: hours and the qualification catalogue.
-- ---------------------------------------------------------------------------

-- can_manage() answers for one team; administering the centre itself is wider.
create function private.can_administer(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m
     where m.organization_id = org and m.user_id = auth.uid() and m.active
       and m.role in ('GESTIONNAIRE', 'ADMIN')
  );
$$;
revoke all on function private.can_administer(uuid) from public;
grant execute on function private.can_administer(uuid) to authenticated;

create policy organization_hours on public.organizations for update to authenticated
  using (private.can_administer(id)) with check (private.can_administer(id));
-- Only the two hours. The name and the timezone stay out of reach, and a campaign
-- keeps the hours it froze at creation whatever happens here.
grant update (day_start, night_start) on public.organizations to authenticated;

create policy qualification_write on public.qualifications for all to authenticated
  using (private.can_administer(organization_id)) with check (private.can_administer(organization_id));
grant insert, delete on public.qualifications to authenticated;
grant update (name) on public.qualifications to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Publication, reachable from a client session.
-- ---------------------------------------------------------------------------

-- PostgREST only routes to exposed schemas, and private must not become one.
-- This wrapper is the whole API surface: it adds no rights of its own, and the
-- definer function behind it still re-checks headcount, qualifications and the
-- eligibility of every agent before freezing a revision.
create function public.publish_shift(shift uuid) returns integer
language sql security invoker set search_path = '' as $$
  select private.publish_schedule_shift(shift);
$$;
revoke all on function public.publish_shift(uuid) from public, anon;
grant execute on function public.publish_shift(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audit trail (§12: author, instant, old value, new value).
-- ---------------------------------------------------------------------------

-- A definer function, so audit rows are written by the engine and never by a
-- client session: authenticated still holds no insert right on audit_logs.
-- Rows are recorded one by one. Reading them back by the handful is a screen
-- concern; losing the detail here would not be recoverable later.
create function private.record_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb := case when TG_OP = 'INSERT' then null else to_jsonb(old) end;
  after_row jsonb := case when TG_OP = 'DELETE' then null else to_jsonb(new) end;
  subject jsonb := coalesce(after_row, before_row);
  org uuid;
  entity text;
  entity_id text;
  action text;
begin
  case TG_TABLE_NAME
    when 'availability_entries' then
      entity := 'availability_entry';
      select c.organization_id into org from public.availability_campaigns c
       where c.id = (subject ->> 'campaign_id')::uuid;
      entity_id := concat_ws('/', subject ->> 'campaign_id', subject ->> 'user_id', subject ->> 'date');
      action := case when TG_OP = 'DELETE' then 'CLEAR' else 'SET' end;
    when 'campaign_participants' then
      entity := 'campaign_participant';
      -- An invalidation is the visible consequence of the availability row
      -- written in the same transaction; recording it again would double every line.
      if after_row ->> 'validated_at' is null then return null; end if;
      org := (subject ->> 'organization_id')::uuid;
      entity_id := concat_ws('/', subject ->> 'campaign_id', subject ->> 'user_id');
      action := 'VALIDATE';
    when 'availability_campaigns' then
      entity := 'availability_campaign';
      org := (subject ->> 'organization_id')::uuid;
      entity_id := subject ->> 'id';
      action := case
        when TG_OP = 'INSERT' then 'CREATE'
        when (after_row ->> 'locked')::boolean then 'LOCK'
        else 'UNLOCK'
      end;
    when 'staffing_requirements' then
      entity := 'staffing_requirement';
      org := (subject ->> 'organization_id')::uuid;
      entity_id := subject ->> 'id';
      action := case when TG_OP = 'DELETE' then 'CLEAR' else 'SET' end;
    when 'schedule_assignments' then
      entity := 'schedule_assignment';
      -- Revision 0 is the draft a manager edits. Higher revisions are written by
      -- the publication, which records its own line against the shift.
      if (subject ->> 'revision')::int <> 0 then return null; end if;
      org := (subject ->> 'organization_id')::uuid;
      entity_id := concat_ws('/', subject ->> 'schedule_shift_id', subject ->> 'user_id');
      action := case when TG_OP = 'DELETE' then 'UNASSIGN' else 'ASSIGN' end;
    when 'organizations' then
      entity := 'organization';
      if before_row ->> 'day_start' is not distinct from after_row ->> 'day_start'
        and before_row ->> 'night_start' is not distinct from after_row ->> 'night_start' then
        return null;
      end if;
      org := (subject ->> 'id')::uuid;
      entity_id := subject ->> 'id';
      action := 'HOURS';
    when 'qualifications' then
      entity := 'qualification';
      org := (subject ->> 'organization_id')::uuid;
      entity_id := subject ->> 'id';
      action := case
        when TG_OP = 'INSERT' then 'CREATE'
        when TG_OP = 'DELETE' then 'DELETE'
        else 'RENAME'
      end;
    else
      return null;
  end case;
  if org is null then return null; end if;
  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (org, auth.uid(), entity, entity_id, action, before_row, after_row);
  return null;
end;
$$;
revoke all on function private.record_audit() from public;

create trigger audit_availability after insert or update or delete on public.availability_entries
  for each row execute function private.record_audit();
create trigger audit_participants after update on public.campaign_participants
  for each row execute function private.record_audit();
create trigger audit_campaigns after insert or update on public.availability_campaigns
  for each row execute function private.record_audit();
create trigger audit_requirements after insert or update or delete on public.staffing_requirements
  for each row execute function private.record_audit();
create trigger audit_assignments after insert or delete on public.schedule_assignments
  for each row execute function private.record_audit();
create trigger audit_organizations after update on public.organizations
  for each row execute function private.record_audit();
create trigger audit_qualifications after insert or update or delete on public.qualifications
  for each row execute function private.record_audit();

-- Attaching agents to qualifications stays out: it belongs with the agent
-- administration screens, and no screen writes it yet.
commit;
