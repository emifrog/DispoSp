-- Lot A des évolutions opérationnelles, seconde partie : les photographies
-- (docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md, « Contrat de
-- photographies »).
--
-- Le bilan du lot E ne peut pas se calculer sur l'état courant : un départ, une
-- promotion ou une qualification acquise réécriraient les mois passés. Cette
-- migration fige, au moment où ils comptent :
--
-- 1. chaque publication d'un créneau — besoin, minima, affectés et leurs
--    qualifications —, dans la transaction de la publication ;
-- 2. chaque clôture de campagne — qui était attendu, qui avait validé —, à la
--    date de clôture ;
-- 3. chaque début de créneau — besoin applicable, effectif encore tenu,
--    couverture —, à l'heure de début.
--
-- Les deux dernières se prennent au passage planifié qui suit l'instant prévu,
-- et avant toute modification qui pourrait changer ce qu'elles retiennent : un
-- passage en retard retrouve ainsi l'état de l'instant prévu. Chacune a deux
-- niveaux : un fait, sans identifiant de personne, qui survit au retrait d'un
-- compte et à la purge des campagnes ; des détails, une ligne par personne,
-- effacés avec elle.
--
-- L'historique commence ici : rien n'est reconstitué pour le passé. Aucune
-- session n'accède à ces tables ; le lot E les exposera par des fonctions qui
-- contrôlent les droits.
--
-- S'applique par-dessus 20261020090000. À coller en entier. Aucun code de
-- l'application n'en dépend ; les scripts de provisionnement, si : retrait d'un
-- compte, purge, bascule et export la supposent appliquée.
begin;

do $$
begin
  if to_regproc('private.generate_due_notifications') is null then
    raise exception 'Appliquez d''abord 20261020090000_traitements_planifies.sql';
  end if;
  if to_regclass('private.history_start') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Le début de l'historique
-- ---------------------------------------------------------------------------
-- Une seule ligne : l'instant où la collecte commence. Avant, le bilan dira
-- « donnée indisponible » plutôt que de fabriquer une précision.
create table private.history_start (
  only_row boolean primary key default true check (only_row),
  started_at timestamptz not null default now()
);
insert into private.history_start default values;
revoke all on private.history_start from public, anon, authenticated;

-- Les bornes d'un créneau en instants, depuis les horaires de la campagne et
-- le fuseau du centre. La nuit appartient à sa date de début.
create function private.shift_bounds(
  on_date date, code text, day_start smallint, night_start smallint, tz text,
  out starts_at timestamptz, out ends_at timestamptz
)
language sql immutable set search_path = '' as $$
  select (on_date + make_time(case when code = 'DAY' then day_start else night_start end, 0, 0)) at time zone tz,
         case when code = 'DAY' then (on_date + make_time(night_start, 0, 0)) at time zone tz
              else ((on_date + 1) + make_time(day_start, 0, 0)) at time zone tz
         end;
$$;
revoke all on function private.shift_bounds(date, text, smallint, smallint, text) from public, anon, authenticated;

-- Le planning est lu par centre et par date à chaque recherche de photographie due.
create index schedule_shifts_organization_date on public.schedule_shifts (organization_id, date);

-- ---------------------------------------------------------------------------
-- 2. Les tables
-- ---------------------------------------------------------------------------
-- Les faits ne portent aucune clé vers un compte, une campagne ou un créneau :
-- seulement vers le centre, que seule la bascule du centre d'essai efface — et
-- elle efface ses faits avec lui. Les détails partent avec leur fait.

-- Une publication : une version publiée d'un créneau.
create table private.publication_facts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  team_id uuid not null,
  team_name text not null,
  campaign_id uuid not null,
  schedule_shift_id uuid not null,
  date date not null,
  shift_code text not null check (shift_code in ('DAY', 'NIGHT')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  revision integer not null check (revision > 0),
  published_at timestamptz not null,
  headcount_required smallint,
  assigned_count integer not null,
  -- [{qualification_id, qualification, minimum, holders}] : les minima du
  -- besoin et le nombre d'affectés qui détiennent chaque qualification.
  minima jsonb not null default '[]',
  -- [{qualification_id, qualification, count}] : toutes les qualifications
  -- détenues par les affectés, exigées ou non — un minimum ajouté après la
  -- publication doit pouvoir se mesurer.
  holders jsonb not null default '[]',
  unique (schedule_shift_id, revision)
);
create index publication_facts_organization_date on private.publication_facts (organization_id, date);

create table private.publication_assignees (
  publication_id bigint not null references private.publication_facts(id) on delete cascade,
  organization_id uuid not null,
  user_id uuid not null,
  role text not null,
  team_id uuid not null,
  qualification_ids uuid[] not null default '{}',
  qualifications text[] not null default '{}',
  primary key (publication_id, user_id)
);
create index publication_assignees_user on private.publication_assignees (user_id);

-- Une clôture : la population attendue d'une campagne à sa date de clôture.
create table private.closure_facts (
  campaign_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  team_id uuid not null,
  team_name text not null,
  campaign_name text not null,
  starts_on date not null,
  ends_on date not null,
  closes_at timestamptz not null,
  taken_at timestamptz not null,
  -- passage : le traitement planifié ; modification : une écriture qui l'a
  -- précédé ; script : retrait d'un compte ou purge.
  source text not null check (source in ('passage', 'modification', 'script')),
  rule text not null,
  participants integer not null,
  expected integer not null,
  validated integer not null
);
create index closure_facts_organization on private.closure_facts (organization_id, starts_on);

create table private.closure_participants (
  campaign_id uuid not null references private.closure_facts(campaign_id) on delete cascade,
  organization_id uuid not null,
  user_id uuid not null,
  role text not null,
  active boolean not null,
  team_id uuid not null,
  expected boolean not null,
  validated_at timestamptz,
  primary key (campaign_id, user_id)
);
create index closure_participants_user on private.closure_participants (user_id);

-- Un début de créneau : ce qui était publié, requis et encore tenu à l'heure de
-- début, publié ou non.
create table private.shift_start_facts (
  schedule_shift_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  team_id uuid not null,
  team_name text not null,
  campaign_id uuid not null,
  date date not null,
  shift_code text not null check (shift_code in ('DAY', 'NIGHT')),
  starts_at timestamptz not null,
  taken_at timestamptz not null,
  source text not null check (source in ('passage', 'modification', 'script')),
  -- 0 : jamais publié.
  revision integer not null,
  published_at timestamptz,
  -- Nul : besoin non renseigné, compté à part, jamais couvert.
  headcount_required smallint,
  -- [{qualification_id, qualification, minimum, holders}] ; holders nul quand
  -- la version en vigueur a été publiée avant le début de l'historique.
  minima jsonb not null default '[]',
  published_count integer not null,
  effective_count integer not null,
  withdrawn_count integer not null,
  -- Nul : indéterminé, faute de photographie de la publication.
  minima_covered boolean,
  covered boolean
);
create index shift_start_facts_organization_date on private.shift_start_facts (organization_id, date);

revoke all on private.publication_facts, private.publication_assignees, private.closure_facts,
  private.closure_participants, private.shift_start_facts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. La publication
-- ---------------------------------------------------------------------------
-- Dans la transaction de la publication : publish_schedule_shift() écrit les
-- affectations de la nouvelle version, puis la version du créneau. Ce
-- déclencheur, sur la seconde, les trouve toutes. La publication mensuelle du
-- lot B passera par le même chemin.
create function private.photograph_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  fact bigint;
begin
  insert into private.publication_facts (organization_id, team_id, team_name, campaign_id, schedule_shift_id, date,
                                         shift_code, starts_at, ends_at, revision, published_at, headcount_required,
                                         assigned_count)
    select new.organization_id, sc.team_id, t.name, sc.campaign_id, new.id, new.date, new.shift_code,
           b.starts_at, b.ends_at, new.published_revision, new.published_at, r.headcount,
           (select count(*) from public.schedule_assignments a
             where a.schedule_shift_id = new.id and a.revision = new.published_revision and a.status <> 'CANCELLED')
      from public.schedules sc
      join public.teams t on t.id = sc.team_id
      join public.availability_campaigns c on c.id = sc.campaign_id
      join public.organizations o on o.id = new.organization_id
      cross join lateral private.shift_bounds(new.date, new.shift_code, c.day_start, c.night_start, o.timezone) b
      left join public.staffing_requirements r
        on r.campaign_id = sc.campaign_id and r.date = new.date and r.shift_code = new.shift_code
     where sc.id = new.schedule_id
  on conflict (schedule_shift_id, revision) do nothing
  returning id into fact;
  if fact is null then
    return null;
  end if;

  insert into private.publication_assignees (publication_id, organization_id, user_id, role, team_id,
                                             qualification_ids, qualifications)
    select fact, a.organization_id, a.user_id, m.role, m.team_id,
           coalesce(array_agg(q.id order by q.name) filter (where q.id is not null), '{}'),
           coalesce(array_agg(q.name order by q.name) filter (where q.id is not null), '{}')
      from public.schedule_assignments a
      join public.memberships m on m.organization_id = a.organization_id and m.user_id = a.user_id
      left join public.user_qualifications uq on uq.organization_id = a.organization_id and uq.user_id = a.user_id
      left join public.qualifications q on q.id = uq.qualification_id
     where a.schedule_shift_id = new.id and a.revision = new.published_revision and a.status <> 'CANCELLED'
     group by a.organization_id, a.user_id, m.role, m.team_id;

  update private.publication_facts f set
    minima = coalesce((
      select jsonb_agg(jsonb_build_object(
               'qualification_id', q.id, 'qualification', q.name, 'minimum', rq.minimum,
               'holders', (select count(*) from private.publication_assignees pa
                            where pa.publication_id = fact and q.id = any(pa.qualification_ids)))
             order by q.name)
        from public.staffing_requirements r
        join public.staffing_requirement_qualifications rq on rq.requirement_id = r.id
        join public.qualifications q on q.id = rq.qualification_id
       where r.campaign_id = f.campaign_id and r.date = f.date and r.shift_code = f.shift_code
    ), '[]'),
    holders = coalesce((
      select jsonb_agg(jsonb_build_object('qualification_id', h.id, 'qualification', h.name, 'count', h.n)
             order by h.name)
        from (
          select u.id, u.name, count(*) as n
            from private.publication_assignees pa
            cross join lateral unnest(pa.qualification_ids, pa.qualifications) as u(id, name)
           where pa.publication_id = fact
           group by u.id, u.name
        ) h
    ), '[]')
   where f.id = fact;
  return null;
end;
$$;
revoke all on function private.photograph_publication() from public, anon, authenticated;
create trigger photograph_publication
  after update of published_revision on public.schedule_shifts
  for each row when (new.published_revision > old.published_revision)
  execute function private.photograph_publication();

-- ---------------------------------------------------------------------------
-- 4. La clôture
-- ---------------------------------------------------------------------------
-- La date de clôture fait foi (décision du 20 octobre) ; le verrouillage,
-- réversible, ne photographie rien. Attendu : participant, membre actif, de
-- rôle AGENT (décision C6). Validé : au plus tard à la clôture.
create function private.photograph_closures(at timestamptz, org uuid, origin text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  since timestamptz := (select h.started_at from private.history_start h);
  c record;
  taken integer := 0;
begin
  for c in
    select ca.id, ca.organization_id, ca.team_id, t.name as team_name, ca.name, ca.starts_on, ca.ends_on, ca.closes_at
      from public.availability_campaigns ca
      join public.teams t on t.id = ca.team_id
     where ca.closes_at <= at and ca.closes_at >= since
       and (org is null or ca.organization_id = org)
       and not exists (select 1 from private.closure_facts f where f.campaign_id = ca.id)
     order by ca.closes_at
  loop
    insert into private.closure_facts (campaign_id, organization_id, team_id, team_name, campaign_name, starts_on,
                                       ends_on, closes_at, taken_at, source, rule, participants, expected, validated)
      values (c.id, c.organization_id, c.team_id, c.team_name, c.name, c.starts_on, c.ends_on, c.closes_at, now(),
              origin, 'participant, membre actif, rôle AGENT (décision C6)', 0, 0, 0)
    on conflict (campaign_id) do nothing;
    continue when not found;
    insert into private.closure_participants (campaign_id, organization_id, user_id, role, active, team_id, expected,
                                              validated_at)
      select c.id, p.organization_id, p.user_id, m.role, m.active, m.team_id,
             m.active and private.takes_shifts(m.role),
             case when p.validated_at <= c.closes_at then p.validated_at end
        from public.campaign_participants p
        join public.memberships m on m.organization_id = p.organization_id and m.user_id = p.user_id
       where p.campaign_id = c.id;
    update private.closure_facts f set
      participants = (select count(*) from private.closure_participants cp where cp.campaign_id = c.id),
      expected = (select count(*) from private.closure_participants cp where cp.campaign_id = c.id and cp.expected),
      validated = (select count(*) from private.closure_participants cp
                    where cp.campaign_id = c.id and cp.expected and cp.validated_at is not null)
     where f.campaign_id = c.id;
    taken := taken + 1;
  end loop;
  return taken;
end;
$$;
revoke all on function private.photograph_closures(timestamptz, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Le début d'un créneau
-- ---------------------------------------------------------------------------
-- Tenu : affecté de la version publiée en vigueur, membre actif de rôle AGENT,
-- sans désistement accepté entre la publication et le début — la règle des
-- rappels de garde. Les qualifications de référence sont celles de la
-- photographie de publication, comparées par identifiant : une qualification
-- acquise ou perdue ensuite n'y change rien.
create function private.photograph_shift_starts(at timestamptz, org uuid, origin text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  since timestamptz := (select h.started_at from private.history_start h);
  d record;
  req uuid;
  need smallint;
  pub bigint;
  holding uuid[];
  n_published integer;
  n_withdrawn integer;
  mins jsonb;
  mins_ok boolean;
  taken integer := 0;
begin
  for d in
    select s.id, s.organization_id, s.date, s.shift_code, s.published_revision, s.published_at,
           sc.team_id, t.name as team_name, sc.campaign_id, b.starts_at
      from public.schedule_shifts s
      join public.schedules sc on sc.id = s.schedule_id
      join public.teams t on t.id = sc.team_id
      join public.availability_campaigns c on c.id = sc.campaign_id
      join public.organizations o on o.id = s.organization_id
      cross join lateral private.shift_bounds(s.date, s.shift_code, c.day_start, c.night_start, o.timezone) b
     where (org is null or s.organization_id = org)
       -- Un premier tri large sur la date, pour l'index ; les instants décident.
       and s.date between (since at time zone 'UTC')::date - 1 and (at at time zone 'UTC')::date + 1
       and b.starts_at <= at and b.starts_at >= since
       and not exists (select 1 from private.shift_start_facts f where f.schedule_shift_id = s.id)
     order by b.starts_at
  loop
    select r.id, r.headcount into req, need
      from public.staffing_requirements r
     where r.campaign_id = d.campaign_id and r.date = d.date and r.shift_code = d.shift_code;
    select f.id into pub
      from private.publication_facts f
     where f.schedule_shift_id = d.id and f.revision = d.published_revision;
    select coalesce(array_agg(x.user_id) filter (where x.held), '{}'), count(*), count(*) filter (where x.withdrawn)
      into holding, n_published, n_withdrawn
      from (
        select a.user_id, w.withdrawn, m.active and private.takes_shifts(m.role) and not w.withdrawn as held
          from public.schedule_assignments a
          join public.memberships m on m.organization_id = a.organization_id and m.user_id = a.user_id
          cross join lateral (
            select exists (
              select 1 from public.shift_withdrawals sw
               where sw.schedule_shift_id = d.id and sw.user_id = a.user_id and sw.state = 'ACCEPTED'
                 and sw.decided_at > d.published_at and sw.decided_at <= d.starts_at
            ) as withdrawn
          ) w
         where d.published_revision > 0 and a.schedule_shift_id = d.id
           and a.revision = d.published_revision and a.status <> 'CANCELLED'
      ) x;
    select coalesce(jsonb_agg(jsonb_build_object(
             'qualification_id', q.id, 'qualification', q.name, 'minimum', rq.minimum,
             'holders', case
                          when d.published_revision = 0 then 0
                          when pub is null then null
                          else (select count(*) from private.publication_assignees pa
                                 where pa.publication_id = pub and pa.user_id = any(holding)
                                   and q.id = any(pa.qualification_ids))
                        end)
             order by q.name), '[]')
      into mins
      from public.staffing_requirement_qualifications rq
      join public.qualifications q on q.id = rq.qualification_id
     where rq.requirement_id = req;
    mins_ok := case
      when exists (select 1 from jsonb_array_elements(mins) e(item)
                    where (e.item ->> 'minimum')::int > 0 and e.item ->> 'holders' is null) then null
      else not exists (select 1 from jsonb_array_elements(mins) e(item)
                        where (e.item ->> 'holders')::int < (e.item ->> 'minimum')::int)
    end;
    insert into private.shift_start_facts (schedule_shift_id, organization_id, team_id, team_name, campaign_id, date,
                                           shift_code, starts_at, taken_at, source, revision, published_at,
                                           headcount_required, minima, published_count, effective_count,
                                           withdrawn_count, minima_covered, covered)
      values (d.id, d.organization_id, d.team_id, d.team_name, d.campaign_id, d.date, d.shift_code, d.starts_at, now(),
              origin, d.published_revision, d.published_at, need, mins, n_published, cardinality(holding), n_withdrawn,
              mins_ok, case when need is null or cardinality(holding) < need then false else mins_ok end)
    on conflict (schedule_shift_id) do nothing;
    if found then
      taken := taken + 1;
    end if;
  end loop;
  return taken;
end;
$$;
revoke all on function private.photograph_shift_starts(timestamptz, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Les photographies dues, et ce qui les déclenche
-- ---------------------------------------------------------------------------
-- Appelée par le passage planifié, par les scripts avant d'effacer, et avant
-- chaque modification qui pourrait changer ce qu'une photographie due doit
-- retenir. Dans ce dernier cas, une fois par transaction et par centre : tout
-- ce qui est dû à cet instant est pris au premier appel, avant la première
-- modification.
create function private.take_due_snapshots(at timestamptz, org uuid default null, origin text default 'passage')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  mark text := txid_current()::text || ':' || coalesce(org::text, 'tous');
  done text := coalesce(current_setting('disposp.photographies', true), '');
begin
  if origin = 'modification' and done in (mark, txid_current()::text || ':tous') then
    return '{}';
  end if;
  perform set_config('disposp.photographies', mark, true);
  return jsonb_build_object(
    'clotures', private.photograph_closures(at, org, origin),
    'debuts', private.photograph_shift_starts(at, org, origin)
  );
end;
$$;
revoke all on function private.take_due_snapshots(timestamptz, uuid, text) from public, anon, authenticated;

create function private.photograph_before_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.take_due_snapshots(now(), old.organization_id, 'modification');
    return old;
  end if;
  perform private.take_due_snapshots(now(), new.organization_id, 'modification');
  return new;
end;
$$;
revoke all on function private.photograph_before_change() from public, anon, authenticated;

-- Le rattachement : rôle, activité, section, départ.
create trigger photograph_before_membership
  before update of active, role, team_id or delete on public.memberships
  for each row execute function private.photograph_before_change();
-- Une participation retirée.
create trigger photograph_before_participant
  before delete on public.campaign_participants
  for each row execute function private.photograph_before_change();
-- Le besoin et ses minima.
create trigger photograph_before_requirement
  before insert or update or delete on public.staffing_requirements
  for each row execute function private.photograph_before_change();
create trigger photograph_before_requirement_minimum
  before insert or update or delete on public.staffing_requirement_qualifications
  for each row execute function private.photograph_before_change();
-- Un désistement demandé ou tranché.
create trigger photograph_before_withdrawal
  before insert or update on public.shift_withdrawals
  for each row execute function private.photograph_before_change();
-- Une nouvelle publication.
create trigger photograph_before_publication
  before update of published_revision on public.schedule_shifts
  for each row execute function private.photograph_before_change();
-- Une affectation effacée.
create trigger photograph_before_assignment
  before delete on public.schedule_assignments
  for each row execute function private.photograph_before_change();
-- Le nom d'une section, recopié dans les faits.
create trigger photograph_before_team
  before update of name on public.teams
  for each row execute function private.photograph_before_change();

-- ---------------------------------------------------------------------------
-- 7. Le passage planifié prend aussi les photographies
-- ---------------------------------------------------------------------------
-- Le corps de 20261020090000, avec une entrée de plus : la tâche Supabase Cron
-- existante suffit.
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
