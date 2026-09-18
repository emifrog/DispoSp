-- Atomic availability templates, after 20260918151529_atomic_campaign_creation.sql.
-- Generated with `supabase migration new atomic_availability_templates`.
-- Apply before deploying the application that calls these two functions.
begin;

do $$
begin
  if to_regproc('public.create_campaign') is null then
    raise exception 'Apply 20260918151529_atomic_campaign_creation.sql first: public.create_campaign is missing';
  end if;
end
$$;

-- Invoker rights, here as elsewhere: the caller's policies decide, and the
-- identity comes from auth.uid(), never from an argument.
--
-- La semaine entière est remplacée en une transaction. Le client faisait un
-- delete puis un insert : un échec du second laissait l'agent sans aucune
-- disponibilité habituelle, alors qu'il venait d'en enregistrer une.
create function public.save_availability_template(org uuid, days jsonb)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare written integer;
begin
  if auth.uid() is null then
    raise exception 'Not allowed to write this template' using errcode = '42501';
  end if;
  if days is null or jsonb_typeof(days) <> 'object' then
    raise exception 'Template must be an object keyed by weekday' using errcode = '22023';
  end if;

  -- L'écran envoie toujours les sept jours : un jour absent, ou nul, veut dire
  -- « rien d'habituel », pas « inchangé ». Tout le reste est laissé aux
  -- contraintes de la table, qui refusent un jour hors semaine ou un type inconnu.
  delete from public.availability_templates
    where organization_id = org and user_id = (select auth.uid());

  insert into public.availability_templates (organization_id, user_id, weekday, availability_type)
  select org, (select auth.uid()), entry.key::smallint, entry.value #>> '{}'
  from jsonb_each(days) as entry
  where jsonb_typeof(entry.value) <> 'null';
  get diagnostics written = row_count;
  return written;
end;
$$;

-- Appliquer, c'est écrire de vraies disponibilités : les déclencheurs de
-- public.availability_entries gardent leurs règles — fenêtre ouverte, date dans
-- la campagne, invalidation de la réponse. Une seule instruction, donc un mois
-- entièrement appliqué ou pas du tout, là où la boucle du client pouvait
-- s'arrêter après deux types sur quatre.
create function public.apply_availability_template(campaign uuid)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare c public.availability_campaigns; written integer;
begin
  if auth.uid() is null then
    raise exception 'Not allowed to apply a template to this campaign' using errcode = '42501';
  end if;
  select * into c from public.availability_campaigns where id = campaign;
  if c.id is null then
    raise exception 'Not allowed to apply a template to this campaign' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.campaign_participants p
    where p.campaign_id = campaign and p.user_id = (select auth.uid())
  ) then
    raise exception 'Not a participant of this campaign' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.availability_templates t
    where t.organization_id = c.organization_id and t.user_id = (select auth.uid())
  ) then
    raise exception 'Availability template is empty' using errcode = 'P0002';
  end if;

  -- Integer day offsets, as for the campaign's shifts: no dependency on the
  -- connection's timezone. isodow numbers the week 1 = Monday, as the table does.
  insert into public.availability_entries (campaign_id, user_id, date, availability_type, comment)
  select campaign, (select auth.uid()), day.date, t.availability_type, ''
  from generate_series(0, c.ends_on - c.starts_on) as offsets(offset_days)
  cross join lateral (select (c.starts_on + offsets.offset_days)::date) as day(date)
  join public.availability_templates t
    on t.organization_id = c.organization_id
   and t.user_id = (select auth.uid())
   and t.weekday = extract(isodow from day.date)
  on conflict (campaign_id, user_id, date) do update
    set availability_type = excluded.availability_type, comment = excluded.comment;
  get diagnostics written = row_count;
  return written;
end;
$$;

-- Remove PUBLIC and any privileges inherited from project-specific defaults.
revoke all on function public.save_availability_template(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_availability_template(uuid) from public, anon, authenticated;
grant execute on function public.save_availability_template(uuid, jsonb) to authenticated;
grant execute on function public.apply_availability_template(uuid) to authenticated;

commit;
