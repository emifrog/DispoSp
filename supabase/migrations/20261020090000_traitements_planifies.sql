-- Lot A des évolutions opérationnelles, première partie
-- (docs/SPECIFICATIONS_EVOLUTIONS_OPERATIONNELLES.md, §5) : traitements
-- planifiés, rappels de garde et relances avant clôture.
--
-- Jusqu'ici, rien ne partait si personne n'agissait : les files d'envoi ne se
-- vidaient qu'après une commande, et aucune relance ni aucun rappel ne naissait
-- d'une échéance. Cette migration apporte ce qu'un déclencheur planifié appelle :
--
-- 1. un réglage par centre — rappels activés ou non, heure du rappel de garde —,
--    désactivé par défaut : l'activation est un geste explicite ;
-- 2. le rappel de garde, la veille à l'heure du centre, et les relances 48 h et
--    24 h avant la clôture, créés en base par private.generate_due_notifications() ;
-- 3. une clé d'événement unique sur les notifications : deux passages, même
--    simultanés, ne créent jamais deux fois le même rappel ;
-- 4. l'annulation des rappels devenus faux avant leur envoi — garde retirée,
--    désistement accepté, réponse validée, campagne fermée —, faite par les
--    deux réservations d'envoi elles-mêmes, que redéfinit cette migration ;
-- 5. le journal des passages, et l'état que l'écran Paramètres en montre.
--
-- La création des tâches Supabase Cron n'est PAS ici : elle se fait par
-- supabase/provisioning/activer-les-traitements-planifies.sql, une fois la
-- migration appliquée et les cibles vérifiées. Sans elle, rien ne s'exécute.
--
-- S'applique par-dessus 20261016200000. À coller en entier. Le code qui
-- l'accompagne lit les nouveaux réglages du centre : à appliquer **avant** de
-- déployer.
begin;

do $$
begin
  if to_regproc('public.apply_week') is null then
    raise exception 'Appliquez d''abord 20261016200000_semaine_type.sql';
  end if;
  if to_regproc('private.generate_due_notifications') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Le réglage du centre
-- ---------------------------------------------------------------------------
-- La policy organization_hours ouvre déjà la mise à jour à l'encadrement du
-- centre ; il ne manquait que le droit sur ces deux colonnes.
alter table public.organizations
  add column reminders_enabled boolean not null default false,
  add column shift_reminder_hour smallint not null default 18 check (shift_reminder_hour between 0 and 23);
grant update (reminders_enabled, shift_reminder_hour) on public.organizations to authenticated;

-- Activer ou couper les rappels est un acte : il entre au journal. record_audit()
-- ignore toute modification du centre qui ne touche pas aux horaires.
create function private.record_reminder_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.reminders_enabled, old.shift_reminder_hour) is not distinct from (new.reminders_enabled, new.shift_reminder_hour) then
    return null;
  end if;
  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (new.id, auth.uid(), 'organization', new.id::text, 'REMINDERS',
            jsonb_build_object('reminders_enabled', old.reminders_enabled, 'shift_reminder_hour', old.shift_reminder_hour),
            jsonb_build_object('reminders_enabled', new.reminders_enabled, 'shift_reminder_hour', new.shift_reminder_hour));
  return null;
end;
$$;
revoke all on function private.record_reminder_settings() from public, anon, authenticated;
create trigger record_reminder_settings
  after update of reminders_enabled, shift_reminder_hour on public.organizations
  for each row execute function private.record_reminder_settings();

-- ---------------------------------------------------------------------------
-- 2. Un genre de notification, et une clé par événement logique
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('CAMPAIGN_OPENED', 'CAMPAIGN_REMINDER', 'SCHEDULE_PUBLISHED',
                  'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_DECIDED', 'SHIFT_REMINDER'));

-- « shift-reminder:<agent>:<date> », « campaign-reminder:<campagne>:<échéance>:<agent> ».
-- Une vérification préalable en code ne suffirait pas : deux passages
-- simultanés la passeraient tous deux.
alter table public.notifications add column event_key text;
create unique index notifications_event_key on public.notifications (event_key) where event_key is not null;

-- ---------------------------------------------------------------------------
-- 3. Ce que les passages retiennent
-- ---------------------------------------------------------------------------
-- Une ligne par campagne et par échéance : 48 h et 24 h avant la clôture.
create table private.campaign_auto_reminders (
  campaign_id uuid not null references public.availability_campaigns(id) on delete cascade,
  stage text not null check (stage in ('48h', '24h')),
  handled_at timestamptz not null default now(),
  -- sent : relance partie ; nobody : tout le monde avait validé ; recent : une
  -- relance ou l'ouverture date de moins de 12 h ; superseded : échéance de
  -- 48 h dépassée par celle de 24 h, après une interruption.
  outcome text not null check (outcome in ('sent', 'nobody', 'recent', 'superseded')),
  recipients integer not null default 0,
  primary key (campaign_id, stage)
);
revoke all on private.campaign_auto_reminders from public, anon, authenticated;

create table private.scheduled_runs (
  id bigint generated always as identity primary key,
  task text not null check (task in ('generation', 'livraison')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb not null default '{}',
  error text
);
create index scheduled_runs_recent on private.scheduled_runs (task, started_at desc);
revoke all on private.scheduled_runs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Le texte d'un rappel
-- ---------------------------------------------------------------------------
-- La locale du serveur ne décide pas des noms : ils sont écrits ici, comme dans
-- premiere-campagne.sql. « mardi 3 novembre », comme l'écran les écrit.
create function private.french_day(d date) returns text
language sql immutable set search_path = '' as $$
  select (array['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'])[extract(isodow from d)::int]
      || ' ' || extract(day from d)::int || ' '
      || (array['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
                'octobre', 'novembre', 'décembre'])[extract(month from d)::int];
$$;
-- Appelée seulement par les fonctions « security definer » plus bas.
revoke all on function private.french_day(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Les gardes qu'un agent tient
-- ---------------------------------------------------------------------------
-- La règle de l'écran (publishedShiftsOf, relieves) : l'affectation porte la
-- version publiée, n'est pas annulée, et aucun désistement n'a été accepté
-- après cette publication. L'agent est actif et prend des gardes (décision C6).
create function private.held_shifts() returns table (
  organization_id uuid, user_id uuid, schedule_shift_id uuid, date date, shift_code text,
  day_start smallint, night_start smallint, published_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select s.organization_id, a.user_id, s.id, s.date, s.shift_code, c.day_start, c.night_start, s.published_at
    from public.schedule_shifts s
    join public.schedules sc on sc.id = s.schedule_id
    join public.availability_campaigns c on c.id = sc.campaign_id
    join public.schedule_assignments a
      on a.schedule_shift_id = s.id and a.revision = s.published_revision and a.status <> 'CANCELLED'
    join public.memberships m
      on m.organization_id = s.organization_id and m.user_id = a.user_id and m.active and private.takes_shifts(m.role)
   where s.published_revision > 0 and s.published_at is not null
     and not exists (
       select 1 from public.shift_withdrawals w
        where w.schedule_shift_id = s.id and w.user_id = a.user_id
          and w.state = 'ACCEPTED' and w.decided_at > s.published_at
     );
$$;
revoke all on function private.held_shifts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Le rappel de garde
-- ---------------------------------------------------------------------------
-- La veille, de l'heure du rappel jusqu'à minuit, heure du centre. Le calcul
-- part de la date locale : « la veille à 18 h » n'est pas « 24 h avant » quand
-- l'heure change dans la nuit. Passé minuit, « demain » serait faux : un
-- passage manqué ne rattrape pas son rappel. Une garde publiée après l'heure
-- du rappel n'en reçoit pas : l'avis de publication vient de partir.
--
-- Le Jour et la Nuit d'une même date font une seule garde de 24 h, et un seul
-- rappel. Deux dates restent deux rappels.
create function private.generate_shift_reminders(at timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare created integer;
begin
  with due as (
    select h.organization_id, h.user_id, h.date, h.shift_code, h.day_start, h.night_start
      from private.held_shifts() h
      join public.organizations o on o.id = h.organization_id and o.reminders_enabled
     where at >= ((h.date - 1) + make_time(o.shift_reminder_hour, 0, 0)) at time zone o.timezone
       and at < h.date::timestamp at time zone o.timezone
       and h.published_at <= ((h.date - 1) + make_time(o.shift_reminder_hour, 0, 0)) at time zone o.timezone
  ), grouped as (
    select organization_id, user_id, date, min(day_start) as day_start, min(night_start) as night_start,
           bool_or(shift_code = 'DAY') as has_day, bool_or(shift_code = 'NIGHT') as has_night
      from due
     group by organization_id, user_id, date
  )
  insert into public.notifications (organization_id, user_id, kind, subject, body, event_key)
  select organization_id, user_id, 'SHIFT_REMINDER', 'Rappel : garde demain',
         'Vous êtes de garde demain, ' || private.french_day(date) || ', '
           || case
                when has_day and has_night then 'de ' || day_start || ' h à ' || day_start || ' h le lendemain (24 h).'
                when has_day then 'de ' || day_start || ' h à ' || night_start || ' h.'
                else 'de ' || night_start || ' h à ' || day_start || ' h le lendemain.'
              end,
         'shift-reminder:' || user_id || ':' || date
    from grouped
  on conflict (event_key) where event_key is not null do nothing;
  get diagnostics created = row_count;
  return created;
end;
$$;
revoke all on function private.generate_shift_reminders(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Les relances avant clôture
-- ---------------------------------------------------------------------------
-- 48 h puis 24 h avant la clôture, aux agents inscrits, actifs, qui n'ont pas
-- validé. La règle des 12 heures de la relance manuelle vaut aussi : une
-- relance — manuelle ou automatique — de moins de 12 h, ou une ouverture de
-- moins de 12 h, suspend l'échéance. Après une interruption, l'échéance de
-- 48 h dépassée n'est pas rattrapée : seule part celle de 24 h.
create function private.generate_campaign_reminders(at timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  due text;
  sent integer;
  created integer := 0;
begin
  for c in
    select ca.id, ca.organization_id, ca.name, ca.opens_at, ca.closes_at, o.timezone
      from public.availability_campaigns ca
      join public.organizations o on o.id = ca.organization_id and o.reminders_enabled
     where not ca.locked and ca.opens_at <= at and at < ca.closes_at
       and at >= ca.closes_at - interval '48 hours'
     order by ca.closes_at
  loop
    due := case when at >= c.closes_at - interval '24 hours' then '24h' else '48h' end;
    continue when exists (
      select 1 from private.campaign_auto_reminders r where r.campaign_id = c.id and r.stage = due
    );
    if due = '24h' then
      insert into private.campaign_auto_reminders (campaign_id, stage, outcome, handled_at)
        values (c.id, '48h', 'superseded', at)
      on conflict (campaign_id, stage) do nothing;
    end if;
    if c.opens_at > at - interval '12 hours' or exists (
      select 1 from private.campaign_reminders r where r.campaign_id = c.id and r.reminded_at > at - interval '12 hours'
    ) then
      insert into private.campaign_auto_reminders (campaign_id, stage, outcome, handled_at)
        values (c.id, due, 'recent', at)
      on conflict (campaign_id, stage) do nothing;
      continue;
    end if;
    -- Le texte de remind_campaign(), pour que l'agent ne distingue pas les deux.
    insert into public.notifications (organization_id, user_id, kind, subject, body, event_key)
      select c.organization_id, p.user_id, 'CAMPAIGN_REMINDER', left('Rappel : ' || c.name, 200),
             'Votre réponse n''est pas encore validée. La saisie ferme le '
               || to_char(c.closes_at at time zone c.timezone, 'DD/MM/YYYY') || '.',
             'campaign-reminder:' || c.id || ':' || due || ':' || p.user_id
        from public.campaign_participants p
        join public.memberships m
          on m.organization_id = c.organization_id and m.user_id = p.user_id and m.active and private.takes_shifts(m.role)
       where p.campaign_id = c.id and p.validated_at is null
    on conflict (event_key) where event_key is not null do nothing;
    get diagnostics sent = row_count;
    -- La relance automatique compte pour la règle des 12 heures de la manuelle.
    if sent > 0 then
      insert into private.campaign_reminders (campaign_id, reminded_at, recipients) values (c.id, at, sent);
    end if;
    insert into private.campaign_auto_reminders (campaign_id, stage, outcome, recipients, handled_at)
      values (c.id, due, case when sent > 0 then 'sent' else 'nobody' end, sent, at)
    on conflict (campaign_id, stage) do nothing;
    created := created + sent;
  end loop;
  return created;
end;
$$;
revoke all on function private.generate_campaign_reminders(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Les rappels devenus faux
-- ---------------------------------------------------------------------------
-- Un rappel qui peut encore partir se recontrôle : la garde est-elle encore
-- tenue, et à venir ? la réponse est-elle toujours à valider, la campagne
-- ouverte ? Sinon, l'email passe à « skipped » et le push à « suppressed ». Ce
-- qui est déjà parti chez le fournisseur ne se rattrape pas.
--
-- « Peut encore partir » : en file, ou réservé mais dont le bail a expiré — la
-- réservation suivante le reprendrait. Un envoi réservé sous un bail en cours
-- est laissé à celui qui le tient.
--
-- Une seule requête : les gardes tenues sont calculées une fois, et seulement
-- s'il reste un rappel de garde à recontrôler. Les deux réservations l'appellent
-- avant chaque lot (plus bas) : le recontrôle ne doit rien coûter quand la file
-- est vide.
create function private.cancel_obsolete_notifications(at timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare cancelled integer;
begin
  with waiting as (
    select n.id, n.kind, n.event_key
      from public.notifications n
     where n.kind in ('SHIFT_REMINDER', 'CAMPAIGN_REMINDER') and n.event_key is not null
       and n.email_status in ('pending', 'sending') and (n.email_status = 'pending' or n.email_available_at <= at)
    union
    select n.id, n.kind, n.event_key
      from public.push_deliveries d
      join public.notifications n on n.id = d.notification_id
     where n.kind in ('SHIFT_REMINDER', 'CAMPAIGN_REMINDER') and n.event_key is not null
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
             else not exists (
               select 1 from public.campaign_participants p
                 join public.availability_campaigns c on c.id = p.campaign_id
                 join public.memberships m
                   on m.organization_id = c.organization_id and m.user_id = p.user_id and m.active
                  and private.takes_shifts(m.role)
                where p.campaign_id = split_part(w.event_key, ':', 2)::uuid
                  and p.user_id = split_part(w.event_key, ':', 4)::uuid
                  and p.validated_at is null and not c.locked and at < c.closes_at)
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
revoke all on function private.cancel_obsolete_notifications(timestamptz) from public, anon, authenticated;

-- La livraison planifiée l'appelle d'abord, pour compter ce qu'elle annule.
create function public.cancel_obsolete_notifications() returns integer
language sql security definer set search_path = '' as $$
  select private.cancel_obsolete_notifications(now());
$$;
revoke all on function public.cancel_obsolete_notifications() from public, anon, authenticated;
grant execute on function public.cancel_obsolete_notifications() to service_role;

-- Les deux réservations recontrôlent avant chaque lot. Les files ne se vident
-- pas seulement au passage planifié : après chaque commande aussi (`after()`),
-- et par /api/push/dispatch. Sans ce recontrôle, le désistement accepté d'un
-- agent viderait la file juste après — et lui enverrait le rappel de la garde
-- qu'il ne tient plus.
--
-- Corps repris de 20260927090000 (emails) et de 20260921100156 (push) ; seule
-- la première instruction s'ajoute.
create or replace function public.claim_email_deliveries(batch integer default 10) returns table (
  id uuid, lease uuid, idempotency_key uuid, email text, kind text, subject text, body text
) language plpgsql security invoker set search_path = '' as $$
begin
  perform public.cancel_obsolete_notifications();
  update public.notifications n set email_status = 'skipped'
    where n.email_status in ('pending', 'sending')
      and not exists (select 1 from public.profiles p where p.user_id = n.user_id and p.email is not null);
  update public.notifications n set email_status = 'skipped'
    where n.email_status in ('pending', 'sending')
      and not exists (
        select 1 from public.memberships m
         where m.user_id = n.user_id and m.organization_id = n.organization_id and m.active
      );
  update public.notifications n set email_status = 'failed'
    where n.email_status in ('pending', 'sending') and n.email_attempts >= 5 and n.email_available_at <= now();
  return query
  with busy as (
    select r.user_id, count(*)::int as sent from public.notifications r
     where (r.email_status = 'sending' and r.email_available_at > now())
        or (r.email_status = 'sent' and r.sent_at > now() - interval '1 hour')
     group by r.user_id
  ), candidates as (
    select n.id,
           coalesce(b.sent, 0) + row_number() over (partition by n.user_id order by n.created_at, n.id) as nth
      from public.notifications n
      left join busy b on b.user_id = n.user_id
     where n.email_status in ('pending', 'sending') and n.email_available_at <= now() and n.email_attempts < 5
  ), selected as (
    select n.id from public.notifications n
      join candidates k on k.id = n.id
     where k.nth <= 10
     order by n.created_at, n.id limit greatest(1, least(batch, 200)) for update of n skip locked
  ), claimed as (
    update public.notifications n
       set email_status = 'sending', email_attempts = n.email_attempts + 1,
           email_lease = gen_random_uuid(), email_available_at = now() + interval '2 minutes'
      from selected where n.id = selected.id
      returning n.id, n.email_lease, n.email_key, n.user_id, n.kind, n.subject, n.body
  ) select c.id, c.email_lease, c.email_key, p.email, c.kind, c.subject, c.body
      from claimed c join public.profiles p on p.user_id = c.user_id;
end;
$$;

create or replace function public.claim_push_deliveries() returns table (
  id uuid, lease uuid, subscription_id uuid, endpoint text, p256dh text, auth text, notification_id uuid, kind text
) language plpgsql security invoker set search_path='' as $$
begin
  perform public.cancel_obsolete_notifications();
  update public.push_deliveries d set status='suppressed'
  where d.status in ('pending','sending') and (
    d.created_at < now()-interval '24 hours' or not exists (
      select 1 from public.push_subscriptions s join public.memberships m
      on m.organization_id=s.organization_id and m.user_id=s.user_id and m.active
      where s.id=d.subscription_id
    )
  );
  update public.push_deliveries d set status='failed'
    where d.status in ('pending','sending') and d.attempts>=5 and d.available_at<=now();
  return query
  with selected as (
    select d.id from public.push_deliveries d where d.status in ('pending','sending')
      and d.available_at<=now() and d.attempts<5
      order by d.available_at,d.id limit 10 for update skip locked
  ), claimed as (
    update public.push_deliveries d set status='sending',attempts=d.attempts+1,
      lease=gen_random_uuid(),available_at=now()+interval '2 minutes'
      from selected where d.id=selected.id
      returning d.id,d.lease,d.subscription_id,d.notification_id
  ) select c.id,c.lease,c.subscription_id,s.endpoint,s.p256dh,s.auth,c.notification_id,n.kind
    from claimed c join public.push_subscriptions s on s.id=c.subscription_id
    join public.notifications n on n.id=c.notification_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Le passage de génération
-- ---------------------------------------------------------------------------
-- Ce que la tâche Supabase Cron appelle toutes les cinq minutes, en SQL seul :
-- ni appel réseau, ni secret. Un verrou empêche deux passages simultanés ;
-- une erreur est inscrite au journal sans annuler l'inscription du passage.
create function private.generate_due_notifications(at timestamptz default now()) returns jsonb
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

-- La livraison inscrit son passage elle-même, sous la clé du serveur.
create function public.record_scheduled_run(task text, ok boolean, summary jsonb, error text) returns void
language sql security definer set search_path = '' as $$
  insert into private.scheduled_runs (task, finished_at, ok, summary, error)
    values (task, clock_timestamp(), ok, coalesce(summary, '{}'), left(error, 300));
$$;
revoke all on function public.record_scheduled_run(text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_scheduled_run(text, boolean, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Ce que l'encadrement en voit
-- ---------------------------------------------------------------------------
-- Le dernier passage de chaque tâche, les erreurs du jour et les envois en
-- attente du centre. Ni message d'erreur, qui peut citer une donnée, ni
-- destinataire : des dates et des nombres.
create function public.scheduled_status(org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.managed_organizations() m where m = org) then
    raise exception 'Not allowed to read the scheduled tasks' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'generation', (select max(finished_at) from private.scheduled_runs where task = 'generation' and ok),
    -- Aucun passage de génération réussi depuis un quart d’heure : les tâches
    -- planifiées ne tournent sans doute pas. L’heure est celle de la base.
    'silencieux', coalesce((select max(finished_at) from private.scheduled_runs where task = 'generation' and ok)
                             < now() - interval '15 minutes', true),
    'livraison', (select max(finished_at) from private.scheduled_runs where task = 'livraison' and ok),
    -- La génération tourne, mais aucune livraison — réussie ou non — n'a suivi
    -- une génération vieille d'un quart d'heure : l'appel n'atteint pas
    -- l'application, ou elle le refuse (adresse ou secret mal recopiés). Un
    -- passage en échec, lui, se compte plus bas.
    'livraison_silencieuse', coalesce((
      select min(g.finished_at) from private.scheduled_runs g
       where g.task = 'generation' and g.ok
         and g.finished_at > coalesce((select max(l.finished_at) from private.scheduled_runs l where l.task = 'livraison'),
                                      '-infinity')
    ) < now() - interval '15 minutes', false),
    'erreurs_24h', (select count(*) from private.scheduled_runs where ok is false and started_at > now() - interval '24 hours'),
    'derniere_erreur', (select max(started_at) from private.scheduled_runs where ok is false),
    'emails_en_attente', (select count(*) from public.notifications
                           where organization_id = org and email_status in ('pending', 'sending')),
    'emails_en_echec_24h', (select count(*) from public.notifications
                             where organization_id = org and email_status = 'failed' and created_at > now() - interval '24 hours'),
    'push_en_attente', (select count(*) from public.push_deliveries d join public.notifications n on n.id = d.notification_id
                         where n.organization_id = org and d.status in ('pending', 'sending'))
  );
end;
$$;
revoke all on function public.scheduled_status(uuid) from public, anon, authenticated;
grant execute on function public.scheduled_status(uuid) to authenticated;

commit;
