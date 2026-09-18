-- Ouverture de la première campagne de disponibilités.
--
-- Temporaire : la création depuis l'interface arrivera avec l'enregistrement en
-- base. En attendant, ce script fait la même chose, avec les droits du
-- propriétaire, depuis l'éditeur SQL du tableau de bord Supabase.
--
-- Par défaut : le mois prochain, réponses ouvertes jusqu'à la fin du mois en
-- cours. Tous les membres actifs de l'équipe sont inscrits comme participants.

begin;
do $$
declare
  org_name  constant text := 'CIS Test';
  team_name constant text := 'Section Test';
  -- Décalage en mois par rapport au mois courant : 1 = le mois prochain.
  month_offset constant int := 1;
  -- Le préfixe v_ évite toute ambiguïté avec les colonnes du même nom : sans lui
  -- PostgreSQL refuse « column reference "team_id" is ambiguous ».
  v_org uuid;
  v_team uuid;
  v_first date;
  v_last date;
  v_campaign uuid;
  v_schedule uuid;
  v_day smallint;
  v_night smallint;
  v_invited int;
  -- to_char dépend de la locale du serveur ; le nom du mois est donc explicite.
  months constant text[] := array['janvier','février','mars','avril','mai','juin',
                                  'juillet','août','septembre','octobre','novembre','décembre'];
begin
  select o.id, t.id into v_org, v_team
    from public.organizations o
    join public.teams t on t.organization_id = o.id
   where o.name = org_name and t.name = team_name;
  if v_org is null then
    raise exception 'Organisation "%" ou équipe "%" introuvable. Lancez d''abord premiere-organisation.sql.', org_name, team_name;
  end if;

  v_first := (date_trunc('month', current_date) + (month_offset || ' month')::interval)::date;
  v_last  := (v_first + interval '1 month - 1 day')::date;
  if exists (select 1 from public.availability_campaigns c where c.organization_id = v_org and c.starts_on = v_first) then
    raise exception 'Une campagne existe déjà pour %.', to_char(v_first, 'MM/YYYY');
  end if;

  select coalesce(max(st.starts_at_hour) filter (where st.code = 'DAY'), 8),
         coalesce(max(st.starts_at_hour) filter (where st.code = 'NIGHT'), 20)
    into v_day, v_night
    from public.shift_types st
   where st.organization_id = v_org;

  insert into public.availability_campaigns
      (organization_id, team_id, name, starts_on, ends_on, opens_at, closes_at, day_start, night_start)
    values (v_org, v_team,
            'Disponibilités de ' || months[extract(month from v_first)::int] || ' ' || extract(year from v_first)::text,
            v_first, v_last,
            -- Ouverte depuis le début du mois en cours, close à sa toute fin.
            date_trunc('month', current_date),
            date_trunc('month', current_date) + interval '1 month' - interval '1 second',
            v_day, v_night)
    returning id into v_campaign;

  -- Chaque membre actif de l'équipe est invité à répondre.
  insert into public.campaign_participants (organization_id, campaign_id, user_id)
    select v_org, v_campaign, m.user_id
      from public.memberships m
     where m.organization_id = v_org and m.team_id = v_team and m.active;
  get diagnostics v_invited = row_count;

  -- Le planning du mois, avec ses créneaux Jour et Nuit, prêt à être construit.
  insert into public.schedules (organization_id, campaign_id, team_id)
    values (v_org, v_campaign, v_team) returning id into v_schedule;
  insert into public.schedule_shifts (organization_id, schedule_id, date, shift_code)
    select v_org, v_schedule, d::date, code
      from generate_series(v_first, v_last, interval '1 day') d,
           unnest(array['DAY', 'NIGHT']) code;

  raise notice 'Campagne % ouverte du % au %, % participant(s) invité(s).', v_campaign, v_first, v_last, v_invited;
end
$$;
commit;
