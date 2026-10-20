-- Lot B des évolutions opérationnelles : publier le mois
-- (docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md, §6).
--
-- Jusqu'ici, un mois se publiait créneau par créneau : soixante gestes, et
-- autant d'avis par agent. Cette migration apporte :
--
-- 1. une seule définition d'un créneau publiable, private.shift_blockers() :
--    la publication unitaire et celle du mois la partagent, et leurs refus
--    gardent les messages d'avant ;
-- 2. un aperçu du mois, public.month_publication_preview() : créneaux prêts,
--    bloqués (et pourquoi), inchangés, avec une empreinte de ce qu'il a vu ;
-- 3. la publication du mois, public.publish_month() : les créneaux prêts, en une
--    transaction, sous verrous pris dans un ordre stable. Elle refuse si
--    l'aperçu n'est plus à jour, et ne publie qu'une fois par identifiant de
--    demande — un double clic ou une reprise réseau rendent le premier résultat ;
-- 4. un seul avis par agent dont les gardes publiées changent — ajouts et
--    retraits, avec dates et horaires, jamais le nom d'un autre agent —, et
--    aucun avis par créneau en plus.
--
-- S'applique par-dessus 20261020150000. À coller en entier. Le code qui
-- l'accompagne appelle les deux nouvelles fonctions : à appliquer **avant** de
-- déployer.
begin;

do $$
begin
  if to_regclass('private.history_start') is null then
    raise exception 'Appliquez d''abord 20261020150000_photographies.sql';
  end if;
  if to_regproc('public.publish_month') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Ce qui empêche un créneau d'être publié
-- ---------------------------------------------------------------------------
-- Les contrôles de private.publish_schedule_shift() (20260927090000), dans le
-- même ordre, rendus au lieu d'être levés : l'aperçu les montre tous, la
-- publication lève le premier. Un seul endroit où définir « publiable ».
create function private.shift_blockers(shift uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  sch public.schedules;
  req public.staffing_requirements;
  retained integer;
  names text;
  reasons jsonb := '[]';
begin
  select * into s from public.schedule_shifts where id = shift;
  if s.id is null then raise exception 'Unknown shift'; end if;
  select * into sch from public.schedules where id = s.schedule_id;

  select count(*) into retained from public.schedule_assignments a
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED';

  -- Une affectation ne se déduit jamais d'une disponibilité : elles doivent
  -- encore s'accorder.
  select string_agg(coalesce(p.display_name, a.user_id::text), ', ' order by p.display_name) into names
    from public.schedule_assignments a
    left join public.profiles p on p.user_id = a.user_id
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     and not exists (
       select 1 from public.availability_entries e
       join public.campaign_participants cp on cp.campaign_id = e.campaign_id and cp.user_id = e.user_id
       where e.campaign_id = sch.campaign_id and e.user_id = a.user_id and e.date = s.date
         and cp.validated_at is not null
         and e.availability_type in (s.shift_code, 'FULL_24H')
     );
  if names is not null then
    reasons := reasons || jsonb_build_object('code', 'availability', 'agents', names);
  end if;

  -- Un agent sorti de l'effectif n'est plus affectable.
  select string_agg(coalesce(p.display_name, a.user_id::text), ', ' order by p.display_name) into names
    from public.schedule_assignments a
    left join public.profiles p on p.user_id = a.user_id
    left join public.memberships m on m.organization_id = sch.organization_id and m.user_id = a.user_id
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     and coalesce(m.active, false) = false;
  if names is not null then
    reasons := reasons || jsonb_build_object('code', 'inactive', 'agents', names);
  end if;

  -- Un désistement accepté depuis l'affectation : remplacer, ou réaffecter.
  select string_agg(coalesce(p.display_name, a.user_id::text), ', ' order by p.display_name) into names
    from public.schedule_assignments a
    left join public.profiles p on p.user_id = a.user_id
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     and private.withdrew_from(shift, a.user_id, a.assigned_at);
  if names is not null then
    reasons := reasons || jsonb_build_object('code', 'withdrawal', 'agents', names);
  end if;

  select * into req from public.staffing_requirements
   where campaign_id = sch.campaign_id and date = s.date and shift_code = s.shift_code;
  if req.id is null then
    reasons := reasons || jsonb_build_object('code', 'requirement');
  else
    if retained < req.headcount then
      reasons := reasons || jsonb_build_object('code', 'headcount', 'assigned', retained, 'required', req.headcount);
    end if;
    select string_agg(q.name, ', ' order by q.name) into names
      from public.staffing_requirement_qualifications rq
      join public.qualifications q on q.id = rq.qualification_id
     where rq.requirement_id = req.id
       and rq.minimum > (
         select count(*) from public.schedule_assignments a
         join public.user_qualifications uq on uq.user_id = a.user_id and uq.qualification_id = rq.qualification_id
         where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
       );
    if names is not null then
      reasons := reasons || jsonb_build_object('code', 'qualifications', 'missing', names);
    end if;
  end if;
  return reasons;
end;
$$;
revoke all on function private.shift_blockers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Publier une version d'un créneau
-- ---------------------------------------------------------------------------
-- Le corps de publish_schedule_shift() (20260927090000), ses contrôles
-- remplacés par shift_blockers(), et ses avis devenus facultatifs : la
-- publication du mois écrit les siens, un par agent.
create function private.publish_shift_version(shift uuid, notify boolean) returns integer
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

  blocker := private.shift_blockers(shift) -> 0;
  if blocker is not null then
    case blocker ->> 'code'
      when 'availability' then
        raise exception 'Every assignment needs a validated matching availability';
      when 'inactive' then
        raise exception 'Inactive members cannot be published: %', blocker ->> 'agents';
      when 'withdrawal' then
        raise exception 'Accepted withdrawal still assigned: %', blocker ->> 'agents';
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
revoke all on function private.publish_shift_version(uuid, boolean) from public, anon, authenticated;

-- La publication unitaire garde sa signature, ses droits et ses avis.
create or replace function private.publish_schedule_shift(shift uuid) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  return private.publish_shift_version(shift, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. L'aperçu du mois
-- ---------------------------------------------------------------------------
-- Chaque créneau de la campagne, dans l'ordre du calendrier :
-- - inchangé : déjà publié, et le brouillon est la version publiée ;
-- - prêt : nouveau ou modifié, et rien ne l'empêche ;
-- - bloqué : nouveau ou modifié, et ses raisons. Il garde sa version publiée
--   s'il en a une : un brouillon incomplet n'efface rien.
-- L'empreinte couvre l'état, la version et le brouillon de chaque créneau :
-- une publication confirmée sur un aperçu périmé est refusée.
create function private.month_preview(campaign uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  items jsonb;
begin
  with shifts as (
    select s.id, s.date, s.shift_code, s.published_revision,
           coalesce((select jsonb_agg(a.user_id order by a.user_id) from public.schedule_assignments a
                      where a.schedule_shift_id = s.id and a.revision = 0 and a.status <> 'CANCELLED'), '[]') as draft,
           coalesce((select jsonb_agg(a.user_id order by a.user_id) from public.schedule_assignments a
                      where a.schedule_shift_id = s.id and s.published_revision > 0
                        and a.revision = s.published_revision and a.status <> 'CANCELLED'), '[]') as published
      from public.schedule_shifts s
      join public.schedules sc on sc.id = s.schedule_id
     where sc.campaign_id = campaign
  ), judged as (
    select sh.*, sh.published_revision > 0 and sh.draft = sh.published as unchanged,
           case when sh.published_revision > 0 and sh.draft = sh.published then '[]'::jsonb
                else private.shift_blockers(sh.id) end as reasons
      from shifts sh
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.id, 'date', j.date, 'shift', j.shift_code, 'revision', j.published_revision,
           'state', case when j.unchanged then 'unchanged' when j.reasons = '[]'::jsonb then 'ready' else 'blocked' end,
           'reasons', j.reasons, 'draft', j.draft)
         order by j.date, j.shift_code), '[]')
    into items
    from judged j;
  return jsonb_build_object(
    'campaign', campaign,
    'fingerprint', md5(items::text),
    -- Le brouillon sert à l'empreinte ; l'écran n'en a pas besoin.
    'shifts', (select coalesce(jsonb_agg(e.item - 'draft' order by e.n), '[]')
                 from jsonb_array_elements(items) with ordinality as e(item, n)),
    'counts', jsonb_build_object(
      'total', jsonb_array_length(items),
      'ready', (select count(*) from jsonb_array_elements(items) e(item) where e.item ->> 'state' = 'ready'),
      'blocked', (select count(*) from jsonb_array_elements(items) e(item) where e.item ->> 'state' = 'blocked'),
      'unchanged', (select count(*) from jsonb_array_elements(items) e(item) where e.item ->> 'state' = 'unchanged')
    )
  );
end;
$$;
revoke all on function private.month_preview(uuid) from public, anon, authenticated;

create function public.month_publication_preview(campaign uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  org uuid;
  team uuid;
begin
  select c.organization_id, c.team_id into org, team from public.availability_campaigns c where c.id = campaign;
  if org is null or not private.can_manage(org, team) then
    raise exception 'Not allowed to publish this schedule';
  end if;
  return private.month_preview(campaign);
end;
$$;
revoke all on function public.month_publication_preview(uuid) from public, anon, authenticated;
grant execute on function public.month_publication_preview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. La publication du mois
-- ---------------------------------------------------------------------------
-- Une ligne par demande : l'identifiant vient de l'écran, une fois par aperçu.
-- Rejouée, la demande rend son premier résultat sans rien republier.
create table private.month_publications (
  request_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  created_at timestamptz not null default now(),
  result jsonb
);
revoke all on private.month_publications from public, anon, authenticated;

-- « novembre 2026 ».
create function private.french_month(d date) returns text
language sql immutable set search_path = '' as $$
  select (array['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
                'octobre', 'novembre', 'décembre'])[extract(month from d)::int] || ' ' || extract(year from d)::int;
$$;
revoke all on function private.french_month(date) from public, anon, authenticated;

create function public.publish_month(campaign uuid, fingerprint text, request uuid) returns jsonb
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
    perform private.publish_shift_version(ready_shift, false);
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
revoke all on function public.publish_month(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_month(uuid, text, uuid) to authenticated;

commit;
