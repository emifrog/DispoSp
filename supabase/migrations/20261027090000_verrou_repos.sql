-- Verrou par agent sur la règle de repos (contrôle du 27 octobre 2026).
--
-- La publication d'un créneau ne verrouillait que la ligne du créneau. Deux
-- publications simultanées de deux créneaux différents — par exemple la Nuit du
-- 31 dans une campagne et le Jour du 1er dans la suivante — jugeaient chacune le
-- repos du même agent avant que l'autre ait validé : toutes deux passaient, et
-- l'agent se retrouvait publié sans son repos. Il fallait deux personnes
-- publiant à la même seconde ; la règle, elle, doit tenir quoi qu'il arrive.
--
-- Cette migration ajoute un verrou de transaction par agent affecté, pris après
-- les verrous de lignes et dans un ordre fixe :
-- - la publication d'un créneau verrouille ses affectés du brouillon avant de
--   juger les blocages ;
-- - la publication du mois verrouille tous les affectés au brouillon du mois,
--   avant l'aperçu qui juge le repos ;
-- - la proposition à un appel verrouille le créneau, l'appel, puis le candidat,
--   avant de rejuger son éligibilité.
-- Les verrous sont pris triés par agent : deux transactions ne peuvent pas
-- s'attendre mutuellement. Tout est libéré à la fin de la transaction.
--
-- Les corps des fonctions sont ceux de 20261021090000, auxquels s'ajoutent ces
-- seules lignes. Aucun droit ne change. S'applique par-dessus 20261021150000. À
-- coller en entier.
begin;

do $$
begin
  if to_regclass('public.calendar_feeds') is null then
    raise exception 'Appliquez d''abord 20261021150000_agenda_abonne.sql';
  end if;
  if to_regproc('private.lock_members') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Le verrou
-- ---------------------------------------------------------------------------
-- Un verrou consultatif de transaction par agent, dans l'espace « disposp:repos »,
-- pris dans l'ordre des identifiants. Reprendre un verrou déjà tenu par la même
-- transaction ne coûte rien : la publication du mois et celle de chacun de ses
-- créneaux se recouvrent sans se gêner.
create function private.lock_members(members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  member uuid;
begin
  for member in select distinct m from unnest(members) as m order by m loop
    perform pg_advisory_xact_lock(hashtext('disposp:repos'), hashtext(member::text));
  end loop;
end;
$$;
revoke all on function private.lock_members(uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. La publication d'un créneau
-- ---------------------------------------------------------------------------
create or replace function private.publish_shift_version(shift uuid, notify boolean, extra uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  sch public.schedules;
  blocker jsonb;
  retained integer;
  next_revision integer;
begin
  select * into s from public.schedule_shifts where id = shift for update;
  if s.id is null then raise exception 'Unknown shift'; end if;
  select * into sch from public.schedules where id = s.schedule_id;
  if not private.can_manage(sch.organization_id, sch.team_id) then
    raise exception 'Not allowed to publish this schedule';
  end if;

  -- Chaque affecté du brouillon, verrouillé par agent : une autre publication
  -- qui l'engage ailleurs attend, et le repos est jugé contre ce qu'elle a
  -- validé, jamais contre ce qu'elle était en train de valider.
  perform private.lock_members((
    select coalesce(array_agg(a.user_id), '{}') from public.schedule_assignments a
     where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'));

  blocker := private.shift_blockers(shift, extra) -> 0;
  if blocker is not null then
    case blocker ->> 'code'
      when 'availability' then
        raise exception 'Every assignment needs a validated matching availability';
      when 'inactive' then
        raise exception 'Inactive members cannot be published: %', blocker ->> 'agents';
      when 'withdrawal' then
        raise exception 'Accepted withdrawal still assigned: %', blocker ->> 'agents';
      when 'rest' then
        raise exception 'Rest not respected: %', blocker ->> 'agents';
      when 'requirement' then
        raise exception 'Define the staffing requirement before publishing';
      when 'headcount' then
        raise exception 'Headcount not covered: % of %', blocker ->> 'assigned', blocker ->> 'required';
      else
        raise exception 'Qualifications not covered: %', blocker ->> 'missing';
    end case;
  end if;

  select count(*) into retained from public.schedule_assignments a
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED';
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

  if notify then
    insert into public.notifications (organization_id, user_id, kind, subject)
      select sch.organization_id, a.user_id, 'SCHEDULE_PUBLISHED', 'Votre planning a été publié'
        from public.schedule_assignments a
       where a.schedule_shift_id = shift and a.revision = next_revision;

    -- La révision 0 est le brouillon : une première publication ne retire personne.
    if s.published_revision > 0 then
      insert into public.notifications (organization_id, user_id, kind, subject, body)
        select sch.organization_id, a.user_id, 'SCHEDULE_PUBLISHED',
               'Planning modifié — garde '
                 || case when s.shift_code = 'DAY' then 'de jour' else 'de nuit' end
                 || ' du ' || to_char(s.date, 'DD/MM/YYYY'),
               'Vous n''êtes plus attendu sur cette garde : la nouvelle version du planning ne vous y affecte plus.'
          from public.schedule_assignments a
          join public.memberships m
            on m.organization_id = sch.organization_id and m.user_id = a.user_id and m.active
         where a.schedule_shift_id = shift and a.revision = s.published_revision and a.status <> 'CANCELLED'
           and not exists (
             select 1 from public.schedule_assignments kept
              where kept.schedule_shift_id = shift and kept.revision = next_revision and kept.user_id = a.user_id
           )
           and not private.withdrew_from(shift, a.user_id, a.assigned_at);
    end if;
  end if;

  return next_revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. La publication du mois
-- ---------------------------------------------------------------------------
create or replace function public.publish_month(campaign uuid, fingerprint text, request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  team uuid;
  day_start smallint;
  night_start smallint;
  month_label text;
  stored jsonb;
  preview jsonb;
  ready uuid[];
  previous jsonb;
  ready_shift uuid;
  notices integer;
  outcome jsonb;
begin
  select c.organization_id, c.team_id, c.day_start, c.night_start, private.french_month(c.starts_on)
    into org, team, day_start, night_start, month_label
    from public.availability_campaigns c where c.id = campaign;
  if org is null or not private.can_manage(org, team) then
    raise exception 'Not allowed to publish this schedule';
  end if;

  -- Une demande déjà vue rend son résultat. Deux envois simultanés de la même
  -- demande : le second attend le premier sur la clé, puis le rejoue.
  insert into private.month_publications (request_id, organization_id, campaign_id)
    values (request, org, campaign)
  on conflict (request_id) do nothing;
  if not found then
    select mp.result into stored from private.month_publications mp
     where mp.request_id = request and mp.campaign_id = campaign;
    if stored is null then
      raise exception 'Month publication request already used';
    end if;
    return stored || jsonb_build_object('replayed', true);
  end if;

  -- Les créneaux du mois, verrouillés dans l'ordre de leur identifiant : deux
  -- publications du même mois s'attendent au lieu de s'interbloquer.
  perform 1 from public.schedule_shifts s
    join public.schedules sc on sc.id = s.schedule_id
   where sc.campaign_id = campaign
   order by s.id
     for update of s;

  -- Puis chaque agent au brouillon d'un créneau du mois, avant l'aperçu : le
  -- repos y est jugé contre des publications achevées, jamais contre une en
  -- cours. Les verrous de chaque créneau, plus bas, retrouvent ceux-ci.
  perform private.lock_members((
    select coalesce(array_agg(distinct a.user_id), '{}')
      from public.schedule_assignments a
      join public.schedule_shifts s on s.id = a.schedule_shift_id
      join public.schedules sc on sc.id = s.schedule_id
     where sc.campaign_id = campaign and a.revision = 0 and a.status <> 'CANCELLED'));

  preview := private.month_preview(campaign);
  if preview ->> 'fingerprint' is distinct from fingerprint then
    raise exception 'Month preview is stale';
  end if;
  select coalesce(array_agg((e.item ->> 'id')::uuid order by e.n), '{}') into ready
    from jsonb_array_elements(preview -> 'shifts') with ordinality as e(item, n)
   where e.item ->> 'state' = 'ready';
  if cardinality(ready) = 0 then
    raise exception 'Nothing ready to publish';
  end if;

  -- Ce que chacun tenait avant : la comparaison des avis se fait sur la version
  -- publiée, pas sur le brouillon.
  select coalesce(jsonb_agg(jsonb_build_object('shift', a.schedule_shift_id, 'user', a.user_id,
                                               'assigned_at', a.assigned_at)), '[]')
    into previous
    from public.schedule_assignments a
    join public.schedule_shifts s on s.id = a.schedule_shift_id
   where s.id = any(ready) and s.published_revision > 0
     and a.revision = s.published_revision and a.status <> 'CANCELLED';

  foreach ready_shift in array ready loop
    -- Chaque créneau jugé avec l'ensemble que l'aperçu a retenu : ce que la
    -- publication voit est ce que l'aperçu a vu.
    perform private.publish_shift_version(ready_shift, false, ready);
  end loop;

  -- Un avis par agent dont les gardes publiées changent. Retiré : comme pour la
  -- publication unitaire, seulement s'il est encore membre actif et qu'il ne
  -- s'était pas désisté — il a déjà reçu la réponse à sa demande.
  with held_before as (
    select (b.item ->> 'shift')::uuid as shift_id, (b.item ->> 'user')::uuid as user_id,
           (b.item ->> 'assigned_at')::timestamptz as assigned_at
      from jsonb_array_elements(previous) as b(item)
  ), held_after as (
    select a.schedule_shift_id as shift_id, a.user_id
      from public.schedule_assignments a
      join public.schedule_shifts s on s.id = a.schedule_shift_id
     where s.id = any(ready) and a.revision = s.published_revision and a.status <> 'CANCELLED'
  ), changes as (
    select n.user_id, n.shift_id, 'added' as change
      from held_after n
     where not exists (select 1 from held_before o where o.shift_id = n.shift_id and o.user_id = n.user_id)
    union all
    select o.user_id, o.shift_id, 'removed'
      from held_before o
      join public.memberships m on m.organization_id = org and m.user_id = o.user_id and m.active
     where not exists (select 1 from held_after n where n.shift_id = o.shift_id and n.user_id = o.user_id)
       and not private.withdrew_from(o.shift_id, o.user_id, o.assigned_at)
  ), lines as (
    -- Le Jour et la Nuit d'une même date font une garde de 24 h.
    select c.user_id, c.change, s.date,
           '– ' || private.french_day(s.date) || ', '
             || case
                  when bool_or(s.shift_code = 'DAY') and bool_or(s.shift_code = 'NIGHT')
                    then 'de ' || day_start || ' h à ' || day_start || ' h le lendemain (24 h)'
                  when bool_or(s.shift_code = 'DAY') then 'de ' || day_start || ' h à ' || night_start || ' h'
                  else 'de ' || night_start || ' h à ' || day_start || ' h le lendemain'
                end as line
      from changes c
      join public.schedule_shifts s on s.id = c.shift_id
     group by c.user_id, c.change, s.date
  ), texts as (
    select l.user_id,
           string_agg(l.line, E'\n' order by l.date) filter (where l.change = 'added') as added,
           string_agg(l.line, E'\n' order by l.date) filter (where l.change = 'removed') as removed
      from lines l
     group by l.user_id
  )
  insert into public.notifications (organization_id, user_id, kind, subject, body, event_key)
    select org, t.user_id, 'SCHEDULE_PUBLISHED',
           'Planning de ' || month_label || case when t.added is not null then ' publié' else ' modifié' end,
           concat_ws(E'\n\n',
                     case when t.added is not null then E'Gardes ajoutées :\n' || t.added end,
                     case when t.removed is not null then E'Gardes retirées :\n' || t.removed end),
           'month-publication:' || request || ':' || t.user_id
      from texts t
  on conflict (event_key) where event_key is not null do nothing;
  get diagnostics notices = row_count;

  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (org, auth.uid(), 'availability_campaign', campaign::text, 'PUBLISH_MONTH', null,
            jsonb_build_object('name', (select c.name from public.availability_campaigns c where c.id = campaign),
                               'published', cardinality(ready), 'notices', notices));

  outcome := jsonb_build_object('published', cardinality(ready), 'notices', notices);
  update private.month_publications set result = outcome where request_id = request;
  return outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. La proposition à un appel
-- ---------------------------------------------------------------------------
create or replace function public.propose_for_call(target uuid, declare_availability boolean, terms text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.shift_calls;
  leaving uuid;
  my_circle text;
  bounds record;
  proposal uuid;
begin
  select * into c from public.shift_calls where id = target;
  if c.id is null or not exists (select 1 from public.call_recipients r where r.call_id = target and r.user_id = me) then
    raise exception 'Not eligible for this call';
  end if;
  -- Le créneau, puis l'appel, puis l'agent : l'ordre des publications, qui
  -- s'attendent ainsi sans s'interbloquer. Son repos est jugé une fois la
  -- publication en cours achevée.
  perform 1 from public.schedule_shifts where id = c.schedule_shift_id for update;
  select * into c from public.shift_calls where id = target for update;
  perform private.lock_members(array[me]);
  if c.state <> 'OPEN' or now() >= c.expires_at then raise exception 'This call is closed'; end if;
  if exists (select 1 from public.call_proposals p
              where p.call_id = target and p.user_id = me and p.state in ('PENDING', 'SELECTED', 'CONFIRMED')) then
    raise exception 'You have already offered for this call';
  end if;
  select w.user_id into leaving from public.shift_withdrawals w where w.id = c.withdrawal_id;
  -- Toujours éligible, maintenant : actif, de l'équipe, sans conflit de repos,
  -- utile au besoin restant.
  select k.circle into my_circle
    from private.call_candidates(c.schedule_shift_id, leaving, private.call_need(c.schedule_shift_id, leaving)) k
   where k.user_id = me;
  if my_circle is null then raise exception 'Not eligible for this call'; end if;
  if my_circle = 'WIDENED' then
    if c.widened_at is null or not declare_availability then
      raise exception 'A declaration of availability is required';
    end if;
    if terms is distinct from private.declaration_terms() then
      raise exception 'The declaration terms have changed';
    end if;
  end if;
  select b.starts_at, b.ends_at into bounds
    from public.availability_campaigns ca
    join public.organizations o on o.id = ca.organization_id
    cross join lateral private.shift_bounds(c.date, c.shift_code, ca.day_start, ca.night_start, o.timezone) b
   where ca.id = c.campaign_id;
  insert into public.call_proposals (call_id, organization_id, user_id, declared, declared_starts_at,
                                     declared_ends_at, terms_version)
    values (target, c.organization_id, me, my_circle = 'WIDENED',
            case when my_circle = 'WIDENED' then bounds.starts_at end,
            case when my_circle = 'WIDENED' then bounds.ends_at end,
            case when my_circle = 'WIDENED' then terms end)
    returning id into proposal;
  return proposal;
end;
$$;

commit;
