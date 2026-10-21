-- Lot C des évolutions opérationnelles : remplacement et renfort
-- (docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md, §7, et les décisions du
-- 21 octobre).
--
-- 1. La règle de repos du centre : après une garde, autant de repos qu'elle a
--    duré — 12 h après 12 h, 24 h après le Jour et la Nuit d'une même date.
--    Un chevauchement d'horaires, a fortiori. Elle entre dans la définition
--    partagée d'un créneau publiable : publication unitaire, du mois, et
--    candidature.
-- 2. L'appel : « Accepter et chercher un remplaçant » depuis un désistement,
--    « Chercher du renfort » depuis un créneau insuffisant. Il vise d'abord les
--    agents de l'équipe dont la disponibilité validée couvre la garde ; le
--    gestionnaire peut l'élargir aux autres.
-- 3. La proposition de l'agent (« Je me propose »), qui ne l'affecte à rien ;
--    pour un appel élargi, elle porte sa déclaration de disponibilité, preuve
--    gardée, sans toucher à la campagne ni à sa réponse validée.
-- 4. Le gestionnaire retient des propositions dans le brouillon ; la
--    publication qui couvre le besoin ferme l'appel, prévient les candidats non
--    retenus et annule les envois devenus inutiles. Un appel peut aussi être
--    annulé, et expire au début de la garde.
--
-- Toutes les écritures passent par des fonctions qui contrôlent droits,
-- éligibilité et concurrence ; aucune session n'écrit dans ces tables.
--
-- S'applique par-dessus 20261020200000. À coller en entier. Le code qui
-- l'accompagne appelle ces fonctions : à appliquer **avant** de déployer.
begin;

do $$
begin
  if to_regproc('public.publish_month') is null then
    raise exception 'Appliquez d''abord 20261020200000_publication_du_mois.sql';
  end if;
  if to_regclass('public.shift_calls') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Les appels, les destinataires, les propositions
-- ---------------------------------------------------------------------------
-- Un appel par créneau à la fois ; une nouvelle recherche après une issue est
-- un nouvel épisode, qui n'écrase pas le délai du précédent. Ils partent avec
-- leur créneau (purge, bascule) ; les destinataires et propositions, avec le
-- rattachement de l'agent (retrait d'un compte).
create table public.shift_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  campaign_id uuid not null references public.availability_campaigns(id) on delete cascade,
  schedule_shift_id uuid not null references public.schedule_shifts(id) on delete cascade,
  date date not null,
  shift_code text not null check (shift_code in ('DAY', 'NIGHT')),
  origin text not null check (origin in ('WITHDRAWAL', 'REINFORCEMENT')),
  withdrawal_id uuid references public.shift_withdrawals(id) on delete set null,
  state text not null default 'OPEN' check (state in ('OPEN', 'RESOLVED', 'CANCELLED', 'EXPIRED')),
  -- Le besoin au déclenchement : {required, kept, missing_headcount, missing_qualifications}.
  need jsonb not null,
  -- La version publiée quand l'appel s'ouvre, puis celle qui couvre le besoin.
  revision_at_open integer not null,
  resolved_revision integer,
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  widened_at timestamptz,
  expires_at timestamptz not null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  check ((state = 'OPEN') = (closed_at is null))
);
create unique index shift_calls_one_open on public.shift_calls (schedule_shift_id) where state = 'OPEN';
create index shift_calls_campaign on public.shift_calls (campaign_id);

create table public.call_recipients (
  call_id uuid not null references public.shift_calls(id) on delete cascade,
  organization_id uuid not null,
  user_id uuid not null,
  -- AVAILABLE : sa disponibilité validée couvre la garde ; WIDENED : l'appel a
  -- été élargi jusqu'à lui.
  circle text not null check (circle in ('AVAILABLE', 'WIDENED')),
  added_at timestamptz not null default now(),
  primary key (call_id, user_id),
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete cascade
);
create index call_recipients_user on public.call_recipients (user_id);

create table public.call_proposals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.shift_calls(id) on delete cascade,
  organization_id uuid not null,
  user_id uuid not null,
  -- PENDING : en attente du gestionnaire ; SELECTED : retenue dans le
  -- brouillon ; CONFIRMED : publiée ; WITHDRAWN : retirée par l'agent ;
  -- DECLINED : non retenue à la fin de l'appel ; RELEASED : retirée du planning
  -- après publication — la preuve ne sert plus.
  state text not null default 'PENDING'
    check (state in ('PENDING', 'SELECTED', 'CONFIRMED', 'WITHDRAWN', 'DECLINED', 'RELEASED')),
  proposed_at timestamptz not null default now(),
  -- La déclaration exceptionnelle : les horaires acceptés et la version des
  -- conditions affichées. Elle ne touche ni à la campagne ni à la réponse.
  declared boolean not null default false,
  declared_starts_at timestamptz,
  declared_ends_at timestamptz,
  terms_version text,
  selected_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  withdrawn_at timestamptz,
  confirmed_at timestamptz,
  closed_at timestamptz,
  check (declared = (declared_starts_at is not null and declared_ends_at is not null and terms_version is not null)),
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete cascade
);
create unique index call_proposals_one_active on public.call_proposals (call_id, user_id)
  where state in ('PENDING', 'SELECTED', 'CONFIRMED');
create index call_proposals_user on public.call_proposals (user_id);

-- Lus sous RLS ; écrits seulement par les fonctions plus bas. L'agent voit les
-- appels qui le sollicitent et ses propres propositions ; l'encadrement, tout
-- ce qui touche son centre. Ni le motif du désistement ni le nom du remplacé
-- n'y figurent.
alter table public.shift_calls enable row level security;
alter table public.call_recipients enable row level security;
alter table public.call_proposals enable row level security;
revoke all on public.shift_calls, public.call_recipients, public.call_proposals from anon, authenticated;
grant select on public.shift_calls, public.call_recipients, public.call_proposals to authenticated;
create policy call_read on public.shift_calls for select to authenticated using (
  organization_id in (select private.managed_organizations())
  or exists (select 1 from public.call_recipients r where r.call_id = id and r.user_id = auth.uid())
);
create policy call_recipient_read on public.call_recipients for select to authenticated using (
  organization_id in (select private.managed_organizations()) or user_id = auth.uid()
);
create policy call_proposal_read on public.call_proposals for select to authenticated using (
  organization_id in (select private.managed_organizations()) or user_id = auth.uid()
);

-- Deux genres d'avis de plus.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('CAMPAIGN_OPENED', 'CAMPAIGN_REMINDER', 'SCHEDULE_PUBLISHED',
                  'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_DECIDED', 'SHIFT_REMINDER',
                  'CALL_OPENED', 'CALL_CLOSED'));

-- ---------------------------------------------------------------------------
-- 2. La règle de repos
-- ---------------------------------------------------------------------------
-- Les engagements d'un agent : ses gardes publiées encore tenues (toutes
-- campagnes), le créneau examiné, et — pour une publication du mois — les
-- brouillons des autres créneaux qu'elle publie avec lui. Le Jour et la Nuit
-- d'une même date forment une garde de 24 h. Après chaque garde, il faut autant
-- de repos qu'elle a duré ; la suivante ne peut pas commencer avant. Rend la
-- garde en cause (« garde du 03/11, Nuit », « brouillon du 04/11, 24 h »), ou
-- rien.
create function private.rest_violation(member uuid, shift uuid, extra uuid[]) returns text
language sql stable security definer set search_path = '' as $$
  with engaged as (
    select s.id, s.date, s.shift_code, c.day_start, c.night_start, o.timezone, false as draft
      from public.schedule_assignments a
      join public.schedule_shifts s on s.id = a.schedule_shift_id and a.revision = s.published_revision
      join public.schedules sc on sc.id = s.schedule_id
      join public.availability_campaigns c on c.id = sc.campaign_id
      join public.organizations o on o.id = s.organization_id
     where a.user_id = member and s.published_revision > 0 and a.status <> 'CANCELLED'
       and s.id <> shift and not s.id = any(extra)
       and not exists (
         select 1 from public.shift_withdrawals w
          where w.schedule_shift_id = s.id and w.user_id = member and w.state = 'ACCEPTED'
            and w.decided_at > s.published_at
       )
    union all
    select s.id, s.date, s.shift_code, c.day_start, c.night_start, o.timezone, true
      from public.schedule_assignments a
      join public.schedule_shifts s on s.id = a.schedule_shift_id
      join public.schedules sc on sc.id = s.schedule_id
      join public.availability_campaigns c on c.id = sc.campaign_id
      join public.organizations o on o.id = s.organization_id
     where a.user_id = member and a.revision = 0 and a.status <> 'CANCELLED'
       and s.id = any(extra) and s.id <> shift
    union all
    select s.id, s.date, s.shift_code, c.day_start, c.night_start, o.timezone, false
      from public.schedule_shifts s
      join public.schedules sc on sc.id = s.schedule_id
      join public.availability_campaigns c on c.id = sc.campaign_id
      join public.organizations o on o.id = s.organization_id
     where s.id = shift
  ), intervals as (
    select e.*, b.starts_at, b.ends_at
      from engaged e
      cross join lateral private.shift_bounds(e.date, e.shift_code, e.day_start, e.night_start, e.timezone) b
  ), paired as (
    -- Le Jour et la Nuit d'une même date, bout à bout : une garde de 24 h.
    select i.date
      from intervals i
     group by i.date
    having count(*) = 2 and bool_or(i.shift_code = 'DAY') and bool_or(i.shift_code = 'NIGHT')
       and max(i.starts_at) = min(i.ends_at)
  ), blocks as (
    select i.date, min(i.starts_at) as starts_at, max(i.ends_at) as ends_at, array_agg(i.id) as ids,
           bool_or(i.draft) as draft, '24 h' as kind
      from intervals i
     where i.date in (select p.date from paired p)
     group by i.date
    union all
    select i.date, i.starts_at, i.ends_at, array[i.id], i.draft,
           case when i.shift_code = 'DAY' then 'Jour' else 'Nuit' end
      from intervals i
     where i.date not in (select p.date from paired p)
  ), ordered as (
    select b.*,
           lag(b.starts_at) over w as prev_start, lag(b.ends_at) over w as prev_end, lag(b.ids) over w as prev_ids,
           lag(b.date) over w as prev_date, lag(b.kind) over w as prev_kind, lag(b.draft) over w as prev_draft
      from blocks b
    window w as (order by b.starts_at, b.ends_at)
  )
  select case
           when shift = any(o.ids)
             then case when o.prev_draft then 'brouillon' else 'garde' end
                  || ' du ' || to_char(o.prev_date, 'DD/MM') || ', ' || o.prev_kind
           else case when o.draft then 'brouillon' else 'garde' end
                || ' du ' || to_char(o.date, 'DD/MM') || ', ' || o.kind
         end
    from ordered o
   where o.prev_end is not null
     and o.starts_at < o.prev_end + (o.prev_end - o.prev_start)
     and (shift = any(o.ids) or shift = any(o.prev_ids))
   order by o.starts_at
   limit 1;
$$;
revoke all on function private.rest_violation(uuid, uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ce qui empêche un créneau d'être publié — repos et déclaration
-- ---------------------------------------------------------------------------
-- La définition de 20261020200000, avec deux changements :
-- - la preuve de disponibilité accepte une déclaration exceptionnelle valide
--   pour cette affectation : proposition retenue (ou déjà publiée) sur un appel
--   de ce créneau, aux horaires du créneau ;
-- - la règle de repos, contrôlée pour chaque affecté du brouillon, contre ses
--   engagements publiés et, pour une publication du mois, contre les brouillons
--   publiés avec lui (`extra`).
-- La version à un argument reste celle de la publication unitaire.
create function private.shift_blockers(shift uuid, extra uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  sch public.schedules;
  req public.staffing_requirements;
  bounds record;
  retained integer;
  names text;
  reasons jsonb := '[]';
begin
  select * into s from public.schedule_shifts where id = shift;
  if s.id is null then raise exception 'Unknown shift'; end if;
  select * into sch from public.schedules where id = s.schedule_id;
  select b.starts_at, b.ends_at into bounds
    from public.availability_campaigns c
    join public.organizations o on o.id = c.organization_id
    cross join lateral private.shift_bounds(s.date, s.shift_code, c.day_start, c.night_start, o.timezone) b
   where c.id = sch.campaign_id;

  select count(*) into retained from public.schedule_assignments a
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED';

  -- Une affectation ne se déduit jamais d'une disponibilité : elles doivent
  -- encore s'accorder — ou une déclaration exceptionnelle la couvre.
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
     )
     and not exists (
       select 1 from public.call_proposals cpr
       join public.shift_calls c on c.id = cpr.call_id
       where c.schedule_shift_id = shift and cpr.user_id = a.user_id and cpr.declared
         and cpr.state in ('SELECTED', 'CONFIRMED')
         and cpr.declared_starts_at = bounds.starts_at and cpr.declared_ends_at = bounds.ends_at
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

  -- La règle de repos du centre (décision du 21 octobre).
  select string_agg(coalesce(p.display_name, x.user_id::text) || ' (' || x.conflict || ')', ', '
                    order by p.display_name) into names
    from (
      select a.user_id, private.rest_violation(a.user_id, shift, extra) as conflict
        from public.schedule_assignments a
       where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
    ) x
    left join public.profiles p on p.user_id = x.user_id
   where x.conflict is not null;
  if names is not null then
    reasons := reasons || jsonb_build_object('code', 'rest', 'agents', names);
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
revoke all on function private.shift_blockers(uuid, uuid[]) from public, anon, authenticated;

create or replace function private.shift_blockers(shift uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.shift_blockers(shift, '{}'::uuid[]);
$$;

-- La publication d'une version : le corps de 20261020200000, avec le refus du
-- repos, jugé avec les autres créneaux que publie la même opération (`extra`,
-- vide pour une publication unitaire).
create function private.publish_shift_version(shift uuid, notify boolean, extra uuid[]) returns integer
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
revoke all on function private.publish_shift_version(uuid, boolean, uuid[]) from public, anon, authenticated;

create or replace function private.publish_shift_version(shift uuid, notify boolean) returns integer
language sql security definer set search_path = '' as $$
  select private.publish_shift_version(shift, notify, '{}'::uuid[]);
$$;

-- L'aperçu du mois : le corps de 20261020200000, la règle de repos jugée avec
-- les créneaux que la publication du mois publiera ensemble. Ceux-là comptent
-- par leur brouillon ; les autres, par leur version publiée, qui reste. Un
-- créneau écarté pour le repos change ce que voient les autres : l'aperçu
-- recommence jusqu'à un ensemble stable — il ne fait que décroître, donc
-- s'arrête. La publication du mois juge chaque créneau avec ce même ensemble :
-- elle ne peut pas échouer en route sur un repos que l'aperçu n'a pas vu.
create or replace function private.month_preview(campaign uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  items jsonb;
  candidates uuid[];
  ready uuid[];
begin
  select coalesce(array_agg(s.id order by s.id), '{}') into candidates
    from public.schedule_shifts s
    join public.schedules sc on sc.id = s.schedule_id
   where sc.campaign_id = campaign
     and not (
       s.published_revision > 0
       and coalesce((select jsonb_agg(a.user_id order by a.user_id) from public.schedule_assignments a
                      where a.schedule_shift_id = s.id and a.revision = 0 and a.status <> 'CANCELLED'), '[]')
         = coalesce((select jsonb_agg(a.user_id order by a.user_id) from public.schedule_assignments a
                      where a.schedule_shift_id = s.id and a.revision = s.published_revision
                        and a.status <> 'CANCELLED'), '[]')
     );
  loop
    select coalesce(array_agg(x.id order by x.id), '{}') into ready
      from unnest(candidates) as x(id)
     where private.shift_blockers(x.id, candidates) = '[]'::jsonb;
    exit when ready = candidates;
    candidates := ready;
  end loop;

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
                when sh.id = any(ready) then '[]'::jsonb
                else private.shift_blockers(sh.id, ready) end as reasons
      from shifts sh
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.id, 'date', j.date, 'shift', j.shift_code, 'revision', j.published_revision,
           'state', case when j.unchanged then 'unchanged' when j.id = any(ready) then 'ready' else 'blocked' end,
           'reasons', case when not j.unchanged and not j.id = any(ready) and j.reasons = '[]'::jsonb
                           then jsonb_build_array(jsonb_build_object('code', 'rest',
                                  'agents', 'conflit avec un autre créneau du mois'))
                           else j.reasons end,
           'draft', j.draft)
         order by j.date, j.shift_code), '[]')
    into items
    from judged j;
  return jsonb_build_object(
    'campaign', campaign,
    'fingerprint', md5(items::text),
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

-- La publication du mois : le corps de 20261020200000, chaque créneau jugé avec
-- les autres créneaux prêts du même mois.
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
revoke all on function public.publish_month(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_month(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Le besoin restant et les candidats
-- ---------------------------------------------------------------------------
-- « mardi 3 novembre, de 8 h à 20 h » : la garde, sans rien de plus.
create function private.shift_text(shift uuid) returns text
language sql stable security definer set search_path = '' as $$
  select private.french_day(s.date) || ', '
         || case when s.shift_code = 'DAY' then 'de ' || c.day_start || ' h à ' || c.night_start || ' h'
                 else 'de ' || c.night_start || ' h à ' || c.day_start || ' h le lendemain' end
    from public.schedule_shifts s
    join public.schedules sc on sc.id = s.schedule_id
    join public.availability_campaigns c on c.id = sc.campaign_id
   where s.id = shift;
$$;
revoke all on function private.shift_text(uuid) from public, anon, authenticated;

-- L'équipe conservée : le brouillon, sans l'agent qui s'en va, sans ceux qu'un
-- désistement accepté, une désactivation ou un rôle d'encadrement écartent.
create function private.kept_team(shift uuid, leaving uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.user_id), '{}')
    from public.schedule_assignments a
    join public.schedule_shifts s on s.id = a.schedule_shift_id
    join public.memberships m on m.organization_id = s.organization_id and m.user_id = a.user_id
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     and a.user_id is distinct from leaving
     and m.active and private.takes_shifts(m.role)
     and not private.withdrew_from(shift, a.user_id, a.assigned_at);
$$;
revoke all on function private.kept_team(uuid, uuid) from public, anon, authenticated;

-- Ce qui manque à l'équipe conservée : des places, des qualifications. Un
-- créneau sans besoin enregistré n'a pas de besoin mesurable.
create function private.call_need(shift uuid, leaving uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  req public.staffing_requirements;
  kept uuid[];
  missing jsonb;
begin
  select * into s from public.schedule_shifts where id = shift;
  select r.* into req
    from public.staffing_requirements r
    join public.schedules sc on sc.campaign_id = r.campaign_id
   where sc.id = s.schedule_id and r.date = s.date and r.shift_code = s.shift_code;
  if req.id is null then
    return null;
  end if;
  kept := private.kept_team(shift, leaving);
  select coalesce(jsonb_agg(jsonb_build_object('qualification_id', q.id, 'qualification', q.name,
                                               'missing', rq.minimum - held.n) order by q.name), '[]')
    into missing
    from public.staffing_requirement_qualifications rq
    join public.qualifications q on q.id = rq.qualification_id
    cross join lateral (
      select count(*)::int as n from public.user_qualifications uq
       where uq.qualification_id = rq.qualification_id and uq.user_id = any(kept)
    ) held
   where rq.requirement_id = req.id and rq.minimum > held.n;
  return jsonb_build_object(
    'required', req.headcount,
    'kept', cardinality(kept),
    'missing_headcount', greatest(0, req.headcount - cardinality(kept)),
    'missing_qualifications', missing
  );
end;
$$;
revoke all on function private.call_need(uuid, uuid) from public, anon, authenticated;

-- Qui peut répondre : agent actif de l'équipe de la campagne, hors de l'équipe
-- conservée, ni l'agent qui s'en va, sans conflit de repos avec ses gardes
-- publiées, et utile — une place manque, ou il détient une qualification qui
-- manque. AVAILABLE si sa disponibilité validée couvre la garde, WIDENED sinon.
create function private.call_candidates(shift uuid, leaving uuid, need jsonb)
returns table (user_id uuid, circle text)
language sql stable security definer set search_path = '' as $$
  with s as (
    select sh.id, sh.date, sh.shift_code, sh.organization_id, sc.campaign_id, c.team_id
      from public.schedule_shifts sh
      join public.schedules sc on sc.id = sh.schedule_id
      join public.availability_campaigns c on c.id = sc.campaign_id
     where sh.id = shift
  )
  select m.user_id,
         case when exists (
           select 1 from public.availability_entries e
           join public.campaign_participants cp on cp.campaign_id = e.campaign_id and cp.user_id = e.user_id
           where e.campaign_id = s.campaign_id and e.user_id = m.user_id and e.date = s.date
             and cp.validated_at is not null and e.availability_type in (s.shift_code, 'FULL_24H')
         ) then 'AVAILABLE' else 'WIDENED' end
    from s
    join public.memberships m on m.organization_id = s.organization_id and m.team_id = s.team_id
   where m.active and private.takes_shifts(m.role)
     and m.user_id is distinct from leaving
     and not m.user_id = any(private.kept_team(shift, leaving))
     and not exists (
       select 1 from public.schedule_assignments a
        where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED' and a.user_id = m.user_id
     )
     and private.rest_violation(m.user_id, shift, '{}') is null
     and (
       (need ->> 'missing_headcount')::int > 0
       or exists (
         select 1 from jsonb_array_elements(need -> 'missing_qualifications') mq(item)
         join public.user_qualifications uq
           on uq.user_id = m.user_id and uq.qualification_id = (mq.item ->> 'qualification_id')::uuid
       )
     );
$$;
revoke all on function private.call_candidates(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Ouvrir, élargir, annuler un appel
-- ---------------------------------------------------------------------------
-- Ce que le gestionnaire voit avant de confirmer : le besoin restant, et combien
-- d'agents l'appel atteindrait, d'abord et après élargissement. Avec un
-- désistement, comme s'il était accepté.
create function public.call_preview(shift uuid, withdrawal uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  sch public.schedules;
  leaving uuid;
  need jsonb;
begin
  select * into s from public.schedule_shifts where id = shift;
  if s.id is null then raise exception 'Unknown shift'; end if;
  select * into sch from public.schedules where id = s.schedule_id;
  if not private.can_manage(sch.organization_id, sch.team_id) then
    raise exception 'Not allowed to call for this shift';
  end if;
  if withdrawal is not null then
    select w.user_id into leaving from public.shift_withdrawals w
     where w.id = withdrawal and w.schedule_shift_id = shift;
    if leaving is null then raise exception 'Unknown withdrawal'; end if;
  end if;
  need := private.call_need(shift, leaving);
  return jsonb_build_object(
    'need', need,
    'available', (select count(*) from private.call_candidates(shift, leaving, need) c where c.circle = 'AVAILABLE'
                   and need is not null),
    'widened', (select count(*) from private.call_candidates(shift, leaving, need) c where c.circle = 'WIDENED'
                 and need is not null),
    'open', exists (select 1 from public.shift_calls c where c.schedule_shift_id = shift and c.state = 'OPEN')
  );
end;
$$;
revoke all on function public.call_preview(uuid, uuid) from public, anon, authenticated;
grant execute on function public.call_preview(uuid, uuid) to authenticated;

-- Prévient un cercle de destinataires, une fois chacun.
create function private.notify_call(target uuid, circle text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c public.shift_calls;
  sent integer;
begin
  select * into c from public.shift_calls where id = target;
  insert into public.notifications (organization_id, user_id, kind, subject, body, event_key)
    select c.organization_id, r.user_id, 'CALL_OPENED',
           'Garde à pourvoir — ' || private.french_day(c.date),
           'Une garde ' || case when c.shift_code = 'DAY' then 'de jour' else 'de nuit' end
             || ' est à pourvoir : ' || private.shift_text(c.schedule_shift_id) || '. '
             || case when notify_call.circle = 'AVAILABLE'
                     then 'Votre disponibilité validée la couvre : si vous pouvez la prendre, proposez-vous dans DispoSP.'
                     else 'Si vous êtes disponible, vous pouvez vous proposer dans DispoSP en le confirmant.' end
             || ' Le gestionnaire confirmera.',
           'call-opened:' || c.id || ':' || r.user_id
      from public.call_recipients r
     where r.call_id = c.id and r.circle = notify_call.circle
  on conflict (event_key) where event_key is not null do nothing;
  get diagnostics sent = row_count;
  return sent;
end;
$$;
revoke all on function private.notify_call(uuid, text) from public, anon, authenticated;

-- Ouvre l'appel. Avec un désistement en attente : l'accepte dans la même
-- transaction — l'agent reçoit sa réponse — et le retire du brouillon ; la
-- version publiée garde son nom jusqu'à la republication.
create function public.open_call(shift uuid, withdrawal uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  sch public.schedules;
  w public.shift_withdrawals;
  need jsonb;
  bounds record;
  new_call uuid;
begin
  select * into s from public.schedule_shifts where id = shift for update;
  if s.id is null then raise exception 'Unknown shift'; end if;
  select * into sch from public.schedules where id = s.schedule_id;
  if not private.can_manage(sch.organization_id, sch.team_id) then
    raise exception 'Not allowed to call for this shift';
  end if;
  if exists (select 1 from public.shift_calls c where c.schedule_shift_id = shift and c.state = 'OPEN') then
    raise exception 'A call is already open for this shift';
  end if;
  select b.starts_at into bounds
    from public.availability_campaigns c
    join public.organizations o on o.id = c.organization_id
    cross join lateral private.shift_bounds(s.date, s.shift_code, c.day_start, c.night_start, o.timezone) b
   where c.id = sch.campaign_id;
  if bounds.starts_at <= now() then
    raise exception 'This shift has already started';
  end if;

  if withdrawal is not null then
    select * into w from public.shift_withdrawals where id = withdrawal and schedule_shift_id = shift for update;
    if w.id is null then raise exception 'Unknown withdrawal'; end if;
    if w.state <> 'PENDING' then raise exception 'This withdrawal has already been decided'; end if;
    -- Les déclencheurs du désistement datent la décision, préviennent l'agent
    -- et l'inscrivent au journal, comme pour une acceptation simple.
    update public.shift_withdrawals set state = 'ACCEPTED' where id = withdrawal;
    delete from public.schedule_assignments
     where schedule_shift_id = shift and user_id = w.user_id and revision = 0;
  end if;

  need := private.call_need(shift, w.user_id);
  if need is null then
    raise exception 'Define the staffing requirement before publishing';
  end if;
  if (need ->> 'missing_headcount')::int = 0 and jsonb_array_length(need -> 'missing_qualifications') = 0 then
    raise exception 'Nothing to fill on this shift';
  end if;

  insert into public.shift_calls (organization_id, campaign_id, schedule_shift_id, date, shift_code, origin,
                                  withdrawal_id, need, revision_at_open, opened_by, expires_at)
    values (s.organization_id, sch.campaign_id, shift, s.date, s.shift_code,
            case when withdrawal is null then 'REINFORCEMENT' else 'WITHDRAWAL' end,
            withdrawal, need, s.published_revision, auth.uid(), bounds.starts_at)
    returning id into new_call;
  insert into public.call_recipients (call_id, organization_id, user_id, circle)
    select new_call, s.organization_id, c.user_id, c.circle
      from private.call_candidates(shift, w.user_id, need) c
     where c.circle = 'AVAILABLE';
  perform private.notify_call(new_call, 'AVAILABLE');

  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (s.organization_id, auth.uid(), 'shift_call', new_call::text, 'OPEN', null,
            jsonb_build_object('date', s.date, 'shift_code', s.shift_code,
                               'origin', case when withdrawal is null then 'REINFORCEMENT' else 'WITHDRAWAL' end,
                               'recipients', (select count(*) from public.call_recipients r where r.call_id = new_call)));
  return new_call;
end;
$$;
revoke all on function public.open_call(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_call(uuid, uuid) to authenticated;

-- Élargit l'appel, sur geste explicite du gestionnaire, aux agents de l'équipe
-- sans disponibilité validée pour la garde. Ceux qui ont retiré leur
-- proposition ne sont pas relancés.
create function public.widen_call(target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c public.shift_calls;
  sch public.schedules;
  leaving uuid;
  added integer;
begin
  select * into c from public.shift_calls where id = target for update;
  if c.id is null then raise exception 'Unknown call'; end if;
  select * into sch from public.schedules sc where sc.campaign_id = c.campaign_id;
  if not private.can_manage(c.organization_id, sch.team_id) then
    raise exception 'Not allowed to call for this shift';
  end if;
  if c.state <> 'OPEN' or now() >= c.expires_at then raise exception 'This call is closed'; end if;
  select w.user_id into leaving from public.shift_withdrawals w where w.id = c.withdrawal_id;
  insert into public.call_recipients (call_id, organization_id, user_id, circle)
    select c.id, c.organization_id, k.user_id, k.circle
      from private.call_candidates(c.schedule_shift_id, leaving, private.call_need(c.schedule_shift_id, leaving)) k
     where k.circle = 'WIDENED'
       and not exists (select 1 from public.call_proposals p
                        where p.call_id = c.id and p.user_id = k.user_id and p.state = 'WITHDRAWN')
  on conflict (call_id, user_id) do nothing;
  get diagnostics added = row_count;
  update public.shift_calls set widened_at = coalesce(widened_at, now()) where id = c.id;
  perform private.notify_call(c.id, 'WIDENED');
  return added;
end;
$$;
revoke all on function public.widen_call(uuid) from public, anon, authenticated;
grant execute on function public.widen_call(uuid) to authenticated;

-- Ferme un appel : candidats non retenus prévenus, sollicitations en attente
-- annulées. RESOLVED par une publication, CANCELLED par le gestionnaire,
-- EXPIRED au début de la garde.
create function private.close_call(target uuid, outcome text, revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.shift_calls;
begin
  select * into c from public.shift_calls where id = target for update;
  if c.state <> 'OPEN' then return; end if;
  -- Les retenus que la publication a confirmés gardent leur preuve.
  if outcome = 'RESOLVED' then
    update public.call_proposals p set state = 'CONFIRMED', confirmed_at = now()
     where p.call_id = c.id and p.state = 'SELECTED'
       and exists (select 1 from public.schedule_assignments a
                    where a.schedule_shift_id = c.schedule_shift_id and a.revision = close_call.revision
                      and a.user_id = p.user_id and a.status <> 'CANCELLED');
  end if;
  insert into public.notifications (organization_id, user_id, kind, subject, body, event_key)
    select c.organization_id, p.user_id, 'CALL_CLOSED',
           'Recherche terminée — ' || private.french_day(c.date),
           'La recherche d''un agent pour la garde ' || case when c.shift_code = 'DAY' then 'de jour' else 'de nuit' end
             || ' du ' || private.shift_text(c.schedule_shift_id) || ', est terminée. '
             || 'Votre proposition n''a pas été retenue. Merci de vous être proposé.',
           'call-closed:' || c.id || ':' || p.user_id
      from public.call_proposals p
     where p.call_id = c.id and p.state in ('PENDING', 'SELECTED')
  on conflict (event_key) where event_key is not null do nothing;
  update public.call_proposals set state = 'DECLINED', closed_at = now()
   where call_id = c.id and state in ('PENDING', 'SELECTED');
  update public.shift_calls
     set state = outcome, closed_at = now(), closed_by = auth.uid(),
         resolved_revision = case when outcome = 'RESOLVED' then close_call.revision end
   where id = c.id;
  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (c.organization_id, auth.uid(), 'shift_call', c.id::text, outcome, null,
            jsonb_build_object('date', c.date, 'shift_code', c.shift_code, 'revision', close_call.revision));
  -- Les sollicitations encore en file ne partent plus.
  perform private.cancel_obsolete_notifications(now());
end;
$$;
revoke all on function private.close_call(uuid, text, integer) from public, anon, authenticated;

create function public.cancel_call(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.shift_calls;
  sch public.schedules;
begin
  select * into c from public.shift_calls where id = target;
  if c.id is null then raise exception 'Unknown call'; end if;
  select * into sch from public.schedules sc where sc.campaign_id = c.campaign_id;
  if not private.can_manage(c.organization_id, sch.team_id) then
    raise exception 'Not allowed to call for this shift';
  end if;
  if c.state <> 'OPEN' then raise exception 'This call is closed'; end if;
  perform private.close_call(target, 'CANCELLED', null);
end;
$$;
revoke all on function public.cancel_call(uuid) from public, anon, authenticated;
grant execute on function public.cancel_call(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. La proposition de l'agent
-- ---------------------------------------------------------------------------
-- La version des conditions affichées avec la déclaration : l'écran envoie
-- celle qu'il a montrée, et la base refuse toute autre.
create function private.declaration_terms() returns text
language sql immutable set search_path = '' as $$
  select 'declaration-2026-10-21';
$$;
revoke all on function private.declaration_terms() from public, anon, authenticated;

-- « Je me propose ». Recontrôlée ici, quoi que l'écran ait montré : appel
-- ouvert et à venir, agent sollicité, toujours éligible, et — s'il n'a pas de
-- disponibilité validée couvrant la garde — déclaration explicite sur un appel
-- élargi. Une visite de lien n'y mène jamais : c'est une écriture.
create function public.propose_for_call(target uuid, declare_availability boolean, terms text) returns uuid
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
revoke all on function public.propose_for_call(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.propose_for_call(uuid, boolean, text) to authenticated;

-- Retirer sa proposition, tant qu'aucune publication ne l'a confirmée. Retenue
-- dans le brouillon, elle en sort : la déclaration est révoquée avec elle.
create function public.withdraw_proposal(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.call_proposals;
  c public.shift_calls;
begin
  select * into p from public.call_proposals
   where call_id = target and user_id = me and state in ('PENDING', 'SELECTED', 'CONFIRMED') for update;
  if p.id is null then raise exception 'No offer to withdraw'; end if;
  if p.state = 'CONFIRMED' then raise exception 'This offer has been published: request a withdrawal instead'; end if;
  select * into c from public.shift_calls where id = target;
  update public.call_proposals set state = 'WITHDRAWN', withdrawn_at = now() where id = p.id;
  if p.state = 'SELECTED' then
    delete from public.schedule_assignments
     where schedule_shift_id = c.schedule_shift_id and user_id = me and revision = 0;
  end if;
end;
$$;
revoke all on function public.withdraw_proposal(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_proposal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Le gestionnaire retient, puis publie
-- ---------------------------------------------------------------------------
-- Retenir une proposition l'inscrit au brouillon. Sous le verrou du créneau :
-- deux gestionnaires ne retiennent pas ensemble la même place. Tout se
-- recontrôle — appel ouvert, éligibilité, repos, besoin restant.
create function public.select_proposal(proposal uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.call_proposals;
  c public.shift_calls;
  sch public.schedules;
  leaving uuid;
  need jsonb;
begin
  select * into p from public.call_proposals where id = proposal;
  if p.id is null then raise exception 'Unknown offer'; end if;
  select * into c from public.shift_calls where id = p.call_id;
  select * into sch from public.schedules sc where sc.campaign_id = c.campaign_id;
  if not private.can_manage(c.organization_id, sch.team_id) then
    raise exception 'Not allowed to call for this shift';
  end if;
  perform 1 from public.schedule_shifts where id = c.schedule_shift_id for update;
  select * into c from public.shift_calls where id = p.call_id for update;
  select * into p from public.call_proposals where id = proposal for update;
  if c.state <> 'OPEN' or now() >= c.expires_at then raise exception 'This call is closed'; end if;
  if p.state <> 'PENDING' then raise exception 'This offer is no longer pending'; end if;
  select w.user_id into leaving from public.shift_withdrawals w where w.id = c.withdrawal_id;
  need := private.call_need(c.schedule_shift_id, leaving);
  if (need ->> 'missing_headcount')::int = 0 and jsonb_array_length(need -> 'missing_qualifications') = 0 then
    raise exception 'The need of this shift is already covered';
  end if;
  if not exists (select 1 from private.call_candidates(c.schedule_shift_id, leaving, need) k
                  where k.user_id = p.user_id and (k.circle = 'AVAILABLE' or p.declared)) then
    raise exception 'This agent is no longer eligible for this shift';
  end if;
  insert into public.schedule_assignments (organization_id, schedule_shift_id, user_id, revision, status, assigned_by)
    values (c.organization_id, c.schedule_shift_id, p.user_id, 0, 'PROPOSED', auth.uid());
  update public.call_proposals
     set state = 'SELECTED', selected_at = now(), decided_at = now(), decided_by = auth.uid()
   where id = p.id;
end;
$$;
revoke all on function public.select_proposal(uuid) from public, anon, authenticated;
grant execute on function public.select_proposal(uuid) to authenticated;

-- Une affectation retirée du brouillon : retenue, la proposition redevient en
-- attente ; publiée, sa preuve cesse de valoir — une réaffectation future
-- demandera une nouvelle déclaration.
create function private.release_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.call_proposals p
     set state = case when p.state = 'SELECTED' then 'PENDING' else 'RELEASED' end,
         selected_at = case when p.state = 'SELECTED' then null else p.selected_at end,
         closed_at = case when p.state = 'CONFIRMED' then now() else p.closed_at end
    from public.shift_calls c
   where c.id = p.call_id and c.schedule_shift_id = old.schedule_shift_id
     and p.user_id = old.user_id and p.state in ('SELECTED', 'CONFIRMED');
  return null;
end;
$$;
revoke all on function private.release_proposal() from public, anon, authenticated;
create trigger release_proposal after delete on public.schedule_assignments
  for each row when (old.revision = 0) execute function private.release_proposal();

-- La publication qui couvre le besoin ferme l'appel. Toute publication est
-- complète — la base refuse les autres —, donc toute publication d'un créneau
-- en appel le résout, qu'elle vienne de l'appel ou du planning.
create function private.resolve_calls() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  open_call_id uuid;
begin
  for open_call_id in select c.id from public.shift_calls c where c.schedule_shift_id = new.id and c.state = 'OPEN' loop
    perform private.close_call(open_call_id, 'RESOLVED', new.published_revision);
  end loop;
  return null;
end;
$$;
revoke all on function private.resolve_calls() from public, anon, authenticated;
create trigger resolve_calls after update of published_revision on public.schedule_shifts
  for each row when (new.published_revision > old.published_revision)
  execute function private.resolve_calls();

-- « Confirmer et publier » : la publication unitaire du créneau, qui ferme
-- l'appel par le déclencheur ci-dessus, en une transaction.
create function public.confirm_call(target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c public.shift_calls;
begin
  select * into c from public.shift_calls where id = target;
  if c.id is null then raise exception 'Unknown call'; end if;
  if not exists (select 1 from public.schedules sc
                  where sc.campaign_id = c.campaign_id and private.can_manage(c.organization_id, sc.team_id)) then
    raise exception 'Not allowed to call for this shift';
  end if;
  -- Le créneau, puis l'appel : l'ordre de select_proposal(). Une seconde
  -- confirmation attend la première, puis trouve l'appel fermé.
  perform 1 from public.schedule_shifts where id = c.schedule_shift_id for update;
  select * into c from public.shift_calls where id = target for update;
  if c.state <> 'OPEN' then raise exception 'This call is closed'; end if;
  return private.publish_shift_version(c.schedule_shift_id, true);
end;
$$;
revoke all on function public.confirm_call(uuid) from public, anon, authenticated;
grant execute on function public.confirm_call(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Les sollicitations devenues inutiles, et l'expiration
-- ---------------------------------------------------------------------------
-- Le recontrôle de 20261020090000, étendu aux sollicitations d'appel :
-- « call-opened:<appel>:<agent> » ne part que si l'appel est encore ouvert et à venir.
create or replace function private.cancel_obsolete_notifications(at timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare cancelled integer;
begin
  with waiting as (
    select n.id, n.kind, n.event_key
      from public.notifications n
     where n.kind in ('SHIFT_REMINDER', 'CAMPAIGN_REMINDER', 'CALL_OPENED') and n.event_key is not null
       and n.email_status in ('pending', 'sending') and (n.email_status = 'pending' or n.email_available_at <= at)
    union
    select n.id, n.kind, n.event_key
      from public.push_deliveries d
      join public.notifications n on n.id = d.notification_id
     where n.kind in ('SHIFT_REMINDER', 'CAMPAIGN_REMINDER', 'CALL_OPENED') and n.event_key is not null
       and d.status in ('pending', 'sending') and (d.status = 'pending' or d.available_at <= at)
  ), held as materialized (
    select h.user_id, h.date, h.shift_code, h.day_start, h.night_start, o.timezone
      from private.held_shifts() h
      join public.organizations o on o.id = h.organization_id
  ), stale as (
    select w.id
      from waiting w
     where case w.kind
             -- shift-reminder:<agent>:<date>
             when 'SHIFT_REMINDER' then not exists (
               select 1 from held h
                where h.user_id = split_part(w.event_key, ':', 2)::uuid
                  and h.date = split_part(w.event_key, ':', 3)::date
                  and at < (h.date + make_time(case when h.shift_code = 'DAY' then h.day_start else h.night_start end, 0, 0))
                             at time zone h.timezone)
             -- campaign-reminder:<campagne>:<échéance>:<agent>
             when 'CAMPAIGN_REMINDER' then not exists (
               select 1 from public.campaign_participants p
                 join public.availability_campaigns c on c.id = p.campaign_id
                 join public.memberships m
                   on m.organization_id = c.organization_id and m.user_id = p.user_id and m.active
                  and private.takes_shifts(m.role)
                where p.campaign_id = split_part(w.event_key, ':', 2)::uuid
                  and p.user_id = split_part(w.event_key, ':', 4)::uuid
                  and p.validated_at is null and not c.locked and at < c.closes_at)
             -- call-opened:<appel>:<agent>
             else not exists (
               select 1 from public.shift_calls c
                where c.id = split_part(w.event_key, ':', 2)::uuid and c.state = 'OPEN' and at < c.expires_at)
           end
  ), emails as (
    update public.notifications n set email_status = 'skipped'
      from stale
     where n.id = stale.id
       and n.email_status in ('pending', 'sending') and (n.email_status = 'pending' or n.email_available_at <= at)
    returning n.id
  ), pushes as (
    update public.push_deliveries d set status = 'suppressed'
      from stale
     where d.notification_id = stale.id
       and d.status in ('pending', 'sending') and (d.status = 'pending' or d.available_at <= at)
    returning d.notification_id
  )
  select count(*) into cancelled from (select id from emails union select notification_id from pushes) touched;
  return cancelled;
end;
$$;

-- Au début de la garde, l'appel encore ouvert expire.
create function private.expire_calls(at timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  open_call_id uuid;
  expired integer := 0;
begin
  for open_call_id in select c.id from public.shift_calls c where c.state = 'OPEN' and c.expires_at <= at loop
    perform private.close_call(open_call_id, 'EXPIRED', null);
    expired := expired + 1;
  end loop;
  return expired;
end;
$$;
revoke all on function private.expire_calls(timestamptz) from public, anon, authenticated;

-- Le passage planifié : le corps de 20261020150000, avec l'expiration des appels.
create or replace function private.generate_due_notifications(at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  run bigint;
  result jsonb := '{}';
begin
  if not pg_try_advisory_xact_lock(hashtext('disposp:generation')) then
    return jsonb_build_object('ignore', 'un passage est déjà en cours');
  end if;
  insert into private.scheduled_runs (task, started_at) values ('generation', clock_timestamp()) returning id into run;
  begin
    result := jsonb_build_object(
      'photographies', private.take_due_snapshots(at, null, 'passage'),
      'appels_expires', private.expire_calls(at),
      'annulations', private.cancel_obsolete_notifications(at),
      'rappels_de_garde', private.generate_shift_reminders(at),
      'relances', private.generate_campaign_reminders(at)
    );
    update private.scheduled_runs set finished_at = clock_timestamp(), ok = true, summary = result where id = run;
  exception when others then
    update private.scheduled_runs set finished_at = clock_timestamp(), ok = false, error = left(sqlerrm, 300)
     where id = run;
  end;
  delete from private.scheduled_runs where started_at < at - interval '30 days';
  return result;
end;
$$;
revoke all on function private.generate_due_notifications(timestamptz) from public, anon, authenticated;

commit;
