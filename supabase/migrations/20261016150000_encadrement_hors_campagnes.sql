-- Décision C6, 16 octobre 2026 : l'encadrement — gestionnaires et
-- administrateurs — ne prend pas de garde, il gère les effectifs. Seuls les
-- agents sont inscrits aux campagnes.
--
-- Faute de décision, la règle provisoire du 25 septembre inscrivait « les
-- membres actifs de l'équipe », encadrement compris, par quatre chemins : la
-- création d'une campagne, l'arrivée en cours de campagne, le déverrouillage et
-- le script de la première campagne. Le tableau de bord comptait donc
-- l'encadrement parmi les réponses attendues, la relance lui écrivait, et il
-- n'avait aucun écran pour répondre (revue d'ergonomie du 16 octobre, B2).
--
-- 1. Une seule règle, private.takes_shifts(rôle), que les trois chemins de la
--    base et la relance appliquent. Le script de la première campagne écrit la
--    même condition en clair.
-- 2. Un membre qui redevient agent rejoint les campagnes ouvertes de son équipe,
--    comme un arrivant. Celui qui passe à l'encadrement reste inscrit là où il
--    l'était, et rien de ce qu'il a saisi n'est effacé : l'application ne le
--    compte plus, et la relance ne lui écrit plus.
-- 3. Le rattrapage retire l'encadrement des campagnes qui ne sont pas closes,
--    s'il n'y a rien saisi. Qui a déjà saisi reste inscrit, et la migration le
--    signale. Les campagnes closes ne bougent pas : elles sont l'historique.
--
-- S'applique par-dessus 20261007150000. À coller en entier. Aucun code ne
-- dépend d'elle : elle s'applique avant ou après un déploiement.
begin;

do $$
begin
  if to_regproc('private.my_organizations') is null then
    raise exception 'Appliquez d''abord 20261007150000_droits_par_ensemble.sql';
  end if;
  if to_regproc('private.takes_shifts') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- Qui prend des gardes, donc répond aux campagnes. create_campaign() s'exécute
-- avec les droits de la session : elle doit pouvoir l'appeler.
create function private.takes_shifts(member_role text) returns boolean
language sql immutable set search_path = '' as $$
  select member_role = 'AGENT';
$$;
revoke all on function private.takes_shifts(text) from public, anon;
grant execute on function private.takes_shifts(text) to authenticated;

-- 1. La création d'une campagne. Le corps est repris de 20260918151529 ; seule
--    l'inscription des participants change.
create or replace function public.create_campaign(
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
    where m.organization_id = org and m.team_id = team and m.active and private.takes_shifts(m.role);

  return campaign_id;
end;
$$;

-- 2. L'arrivée en cours de campagne (20260925090000). La règle est vérifiée ici,
--    et non dans le seul déclencheur : les rattrapages l'appellent aussi.
create or replace function private.join_open_campaigns(org uuid, member uuid, team uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare joined integer;
begin
  insert into public.campaign_participants (organization_id, campaign_id, user_id)
    select c.organization_id, c.id, member
      from public.availability_campaigns c
     where c.organization_id = org and c.team_id = team
       and not c.locked and c.closes_at > now()
       and exists (
         select 1 from public.memberships m
          where m.organization_id = org and m.user_id = member and m.active and private.takes_shifts(m.role)
       )
    on conflict (campaign_id, user_id) do nothing;
  get diagnostics joined = row_count;
  return joined;
end;
$$;

-- Le rôle compte désormais : redevenir agent fait rejoindre les campagnes
-- ouvertes, comme un rattachement ou un changement d'équipe.
create or replace function private.join_campaigns_on_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.active or not private.takes_shifts(new.role) then return null; end if;
  if TG_OP = 'UPDATE' and old.active and old.team_id is not distinct from new.team_id
     and private.takes_shifts(old.role) then
    return null;
  end if;
  perform private.join_open_campaigns(new.organization_id, new.user_id, new.team_id);
  return null;
end;
$$;
drop trigger join_campaigns_on_membership on public.memberships;
create trigger join_campaigns_on_membership
  after insert or update of active, team_id, role on public.memberships
  for each row execute function private.join_campaigns_on_membership();

-- 3. Le déverrouillage (20261005090000).
create or replace function private.join_unlocked_campaign() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (old.locked and not new.locked) or new.closes_at <= now() then return null; end if;
  insert into public.campaign_participants (organization_id, campaign_id, user_id)
    select new.organization_id, new.id, m.user_id
      from public.memberships m
     where m.organization_id = new.organization_id and m.team_id = new.team_id and m.active
       and private.takes_shifts(m.role)
    on conflict (campaign_id, user_id) do nothing;
  return null;
end;
$$;

-- 4. La relance. Le corps est repris de 20260923200000 ; seule la jointure sur
--    l'appartenance change. Un agent passé à l'encadrement en cours de campagne
--    y reste inscrit : la relance ne lui écrit plus pour autant.
create or replace function public.remind_campaign(campaign uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.availability_campaigns; created integer;
begin
  select * into c from public.availability_campaigns where id = campaign for update;
  if c.id is null or not private.can_manage(c.organization_id, c.team_id) then
    raise exception 'Not allowed to remind this campaign';
  end if;
  -- « La saisie ferme le… » avec une date passée : il n'y a plus rien à demander.
  if c.locked or now() < c.opens_at or now() > c.closes_at then
    raise exception 'Cannot remind a closed campaign';
  end if;
  if exists (
    select 1 from private.campaign_reminders r
     where r.campaign_id = campaign and r.reminded_at > now() - interval '12 hours'
  ) then
    raise exception 'Campaign reminded too recently';
  end if;
  insert into public.notifications (organization_id, user_id, kind, subject, body)
    select c.organization_id, p.user_id, 'CAMPAIGN_REMINDER',
           left('Rappel : ' || c.name, 200),
           'Votre réponse n''est pas encore validée. La saisie ferme le '
             || to_char(c.closes_at at time zone 'Europe/Paris', 'DD/MM/YYYY') || '.'
      from public.campaign_participants p
      join public.memberships m on m.organization_id = c.organization_id and m.user_id = p.user_id and m.active
                                and private.takes_shifts(m.role)
     where p.campaign_id = campaign and p.validated_at is null;
  get diagnostics created = row_count;
  if created > 0 then
    insert into private.campaign_reminders (campaign_id, recipients) values (campaign, created);
  end if;
  return created;
end;
$$;

-- Le rattrapage. Les campagnes closes sont l'historique : on n'y touche pas.
do $$
declare
  removed integer;
  kept integer;
begin
  delete from public.campaign_participants p
   using public.availability_campaigns c, public.memberships m
   where c.id = p.campaign_id and c.closes_at > now()
     and m.organization_id = p.organization_id and m.user_id = p.user_id
     and not private.takes_shifts(m.role)
     and not exists (
       select 1 from public.availability_entries e where e.campaign_id = p.campaign_id and e.user_id = p.user_id
     );
  get diagnostics removed = row_count;
  select count(*) into kept
    from public.campaign_participants p
    join public.availability_campaigns c on c.id = p.campaign_id
    join public.memberships m on m.organization_id = p.organization_id and m.user_id = p.user_id
   where c.closes_at > now() and not private.takes_shifts(m.role);
  raise notice '% inscription(s) de l''encadrement retirée(s) des campagnes en cours ; % gardée(s), qui portent déjà des saisies.',
    removed, kept;
end
$$;

commit;
