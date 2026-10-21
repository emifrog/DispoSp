-- Lot D des évolutions opérationnelles : l'agenda personnel abonné
-- (docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md, §8).
--
-- Un agent s'abonne depuis Mon planning : son logiciel d'agenda lit une adresse
-- privée, sans session de navigateur, et y trouve ses gardes publiées. Cette
-- migration apporte :
--
-- 1. l'abonnement : un par agent à la fois, révocable. La base ne garde que le
--    condensat SHA-256 du jeton ; le jeton lui-même est tiré par le serveur de
--    l'application et rendu une seule fois à l'agent ;
-- 2. la lecture du flux, réservée au serveur : à chaque lecture, l'abonnement
--    doit être actif, et l'agent toujours membre actif qui prend des gardes —
--    une désactivation, une promotion ou une révocation coupent l'accès.
--
-- Le flux ne contient que les gardes publiées encore tenues : ni brouillon, ni
-- proposition, ni garde dont un désistement accepté a relevé l'agent. Une garde
-- retirée disparaît du flux ; un abonnement se relit en entier à chaque
-- synchronisation, et le logiciel d'agenda la retire de lui-même.
--
-- S'applique par-dessus 20261021090000. À coller en entier. Le code qui
-- l'accompagne appelle ces fonctions : à appliquer **avant** de déployer.
begin;

do $$
begin
  if to_regclass('public.shift_calls') is null then
    raise exception 'Appliquez d''abord 20261021090000_appels_remplacement.sql';
  end if;
  if to_regclass('public.calendar_feeds') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. L'abonnement
-- ---------------------------------------------------------------------------
-- Il part avec le rattachement de l'agent (retrait d'un compte, bascule).
create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  -- Le condensat SHA-256 du jeton, en hexadécimal. Jamais le jeton.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_read_at timestamptz,
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete cascade
);
create unique index calendar_feeds_one_active on public.calendar_feeds (user_id) where revoked_at is null;

-- L'agent lit son abonnement, sans le condensat ; il ne l'écrit que par les
-- fonctions plus bas.
alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;
grant select (id, user_id, created_at, revoked_at, last_read_at) on public.calendar_feeds to authenticated;
create policy calendar_feed_read on public.calendar_feeds for select to authenticated using (user_id = auth.uid());

-- Créer — ou remplacer — l'abonnement de l'agent connecté. L'ancien est
-- révoqué dans la même transaction : son adresse ne lit plus rien.
create function public.create_calendar_feed(token_hash text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  org uuid;
  created timestamptz;
begin
  select m.organization_id into org
    from public.memberships m
   where m.user_id = me and m.active and private.takes_shifts(m.role);
  if org is null then
    raise exception 'Not allowed to subscribe to a calendar';
  end if;
  if token_hash is null or token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid calendar token';
  end if;
  update public.calendar_feeds set revoked_at = now() where user_id = me and revoked_at is null;
  insert into public.calendar_feeds (organization_id, user_id, token_hash)
    values (org, me, create_calendar_feed.token_hash)
    returning created_at into created;
  return created;
end;
$$;
revoke all on function public.create_calendar_feed(text) from public, anon, authenticated;
grant execute on function public.create_calendar_feed(text) to authenticated;

create function public.revoke_calendar_feed() returns void
language sql security definer set search_path = '' as $$
  update public.calendar_feeds set revoked_at = now() where user_id = auth.uid() and revoked_at is null;
$$;
revoke all on function public.revoke_calendar_feed() from public, anon, authenticated;
grant execute on function public.revoke_calendar_feed() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Le flux
-- ---------------------------------------------------------------------------
-- Ce que lit le serveur pour un condensat : rien si l'abonnement est inconnu,
-- révoqué, ou si l'agent n'est plus membre actif qui prend des gardes. Sinon
-- ses gardes publiées encore tenues, de trois mois en arrière à douze mois en
-- avant (valeurs de départ du §2), avec ce qu'il faut pour un identifiant
-- stable et une séquence de révision. La lecture est datée.
create function public.calendar_feed_events(token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  feed public.calendar_feeds;
  today date := (now() at time zone 'Europe/Paris')::date;
begin
  select f.* into feed
    from public.calendar_feeds f
    join public.memberships m on m.organization_id = f.organization_id and m.user_id = f.user_id
   where f.token_hash = calendar_feed_events.token_hash and f.revoked_at is null
     and m.active and private.takes_shifts(m.role);
  if feed.id is null then
    return null;
  end if;
  update public.calendar_feeds set last_read_at = now() where id = feed.id;
  return jsonb_build_object(
    'user_id', feed.user_id,
    'centre', (select o.name from public.organizations o where o.id = feed.organization_id),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'campaign_id', c.id, 'date', s.date, 'shift', s.shift_code,
               'day_start', c.day_start, 'night_start', c.night_start,
               'revision', s.published_revision, 'published_at', s.published_at)
             order by s.date, s.shift_code)
        from public.schedule_assignments a
        join public.schedule_shifts s on s.id = a.schedule_shift_id and a.revision = s.published_revision
        join public.schedules sc on sc.id = s.schedule_id
        join public.availability_campaigns c on c.id = sc.campaign_id
       where a.user_id = feed.user_id and s.organization_id = feed.organization_id
         and s.published_revision > 0 and a.status <> 'CANCELLED'
         and s.date between today - interval '3 months' and today + interval '12 months'
         and not exists (
           select 1 from public.shift_withdrawals w
            where w.schedule_shift_id = s.id and w.user_id = feed.user_id and w.state = 'ACCEPTED'
              and w.decided_at > s.published_at
         )
    ), '[]')
  );
end;
$$;
revoke all on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to service_role;

commit;
