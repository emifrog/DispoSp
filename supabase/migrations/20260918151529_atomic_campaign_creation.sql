-- Atomic campaign creation, after 0007_availability_templates.sql.
-- Generated with `supabase migration new atomic_campaign_creation`.
-- Apply before deploying the application that calls public.create_campaign().
begin;

do $$
begin
  if to_regclass('public.availability_templates') is null then
    raise exception 'Apply 0007_availability_templates.sql first: public.availability_templates is missing';
  end if;
end
$$;

-- Invoker rights: every statement retains the caller's RLS policies. No user ID,
-- participant list or hours are trusted from the browser. A failure, including
-- in an audit/notification trigger, rolls back the entire RPC transaction.
create function public.create_campaign(
  org uuid,
  team uuid,
  campaign_name text,
  campaign_month date,
  closes_on date
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  centre public.organizations;
  campaign_id uuid;
  schedule_id uuid;
  last_day date;
  closing_instant timestamptz;
begin
  if auth.uid() is null or not private.can_manage(org, team) then
    raise exception 'Not allowed to create this campaign' using errcode = '42501';
  end if;
  if campaign_name is null or length(btrim(campaign_name)) < 3 then
    raise exception 'Campaign name is too short' using errcode = '23514';
  end if;
  if campaign_month is null or not isfinite(campaign_month)
     or extract(day from campaign_month) <> 1 then
    raise exception 'Campaign month must start on the first day' using errcode = '23514';
  end if;

  select * into strict centre from public.organizations where id = org;
  closing_instant := (closes_on + time '23:59:59') at time zone centre.timezone;
  if closes_on is null or not isfinite(closes_on) or closing_instant <= now() then
    raise exception 'Campaign closing date must be in the future' using errcode = '23514';
  end if;
  last_day := (campaign_month + interval '1 month' - interval '1 day')::date;

  insert into public.availability_campaigns (
    organization_id, team_id, name, starts_on, ends_on, opens_at, closes_at, day_start, night_start
  ) values (
    org, team, btrim(campaign_name), campaign_month, last_day, now(), closing_instant,
    centre.day_start, centre.night_start
  ) returning id into campaign_id;

  insert into public.schedules (organization_id, campaign_id, team_id)
    values (org, campaign_id, team) returning id into schedule_id;

  -- Integer day offsets avoid a dependency on the connection's timezone/DST.
  -- NIGHT is attached to the same start date as DAY, even on the last day.
  insert into public.schedule_shifts (organization_id, schedule_id, date, shift_code)
    select org, schedule_id, campaign_month + days.offset_days, shifts.code
    from generate_series(0, last_day - campaign_month) as days(offset_days)
    cross join (values ('DAY'), ('NIGHT')) as shifts(code);

  insert into public.campaign_participants (organization_id, campaign_id, user_id)
    select org, campaign_id, m.user_id
    from public.memberships m
    where m.organization_id = org and m.team_id = team and m.active;

  return campaign_id;
end;
$$;

-- Remove PUBLIC and any privileges inherited from project-specific defaults.
revoke all on function public.create_campaign(uuid, uuid, text, date, date) from public, anon, authenticated;
grant execute on function public.create_campaign(uuid, uuid, text, date, date) to authenticated;

commit;
