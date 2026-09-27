-- Correctifs du bilan avant déploiement du 27 septembre 2026
-- (docs/BILAN_AVANT_DEPLOIEMENT_2026-09-27.md), tous reproduits sur une base
-- neuve avant d'être corrigés.
--
-- 1. Réinscrire un appareil effaçait ses envois en attente.
--    register_push_subscription() effaçait l'abonnement puis le recréait, et
--    push_deliveries le suit en cascade. L'application redit l'abonnement à
--    chaque ouverture : chaque ouverture perdait les relances de cet appareil.
-- 2. Un appareil partagé changeait de main sans que personne le demande. Le même
--    appel, fait à l'ouverture pour le compte connecté, reprenait l'abonnement
--    du précédent — qui ne recevait plus rien — pour un compte qui n'avait
--    jamais accepté les notifications.
-- 3. Un agent retiré d'une garde à la republication n'en était pas prévenu :
--    seuls les agents de la nouvelle version recevaient un avis, et le dernier
--    qu'il avait reçu lui annonçait encore cette garde.
-- 4. L'ancien centre gardait la main sur la fiche d'un agent parti ailleurs. La
--    policy de 20260922100000 ouvre la fiche à l'administration de tout centre
--    où l'agent a un rattachement, même inactif — y compris quand il est
--    désormais actif dans un autre, qui voit alors le changement.
-- 5. Un email pouvait partir deux fois. Un passage qui dépasse son bail voit son
--    message repris par un autre, alors qu'il est peut-être encore en train de
--    l'envoyer. Chaque notification porte désormais une clé que Resend
--    reconnaît : le second envoi du même message n'en est pas un.
--
-- S'applique par-dessus 20260925180000. À coller en entier, avant de déployer
-- le code qui l'accompagne : la route d'abonnement appelle la nouvelle
-- signature de register_push_subscription().
begin;

do $$
begin
  if to_regproc('private.check_requirement_headcount') is null then
    raise exception 'Appliquez d''abord 20260925180000_correctifs_mineurs.sql';
  end if;
  if to_regproc('private.active_elsewhere') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1 et 2. Un appareil se réinscrit sans rien perdre, et ne change de main que
--         si on le lui demande.
-- ---------------------------------------------------------------------------
--
-- Trois cas, et chacun garde ce qu'il doit :
--
-- - l'appareil est déjà celui de l'appelant : la ligne reste — et avec elle son
--   identifiant, donc ses envois en attente ou en cours. Seules les clés et le
--   centre sont rafraîchis ;
-- - il est à un autre compte, ou à personne : il ne passe à l'appelant que si
--   celui-ci le réclame (`claim`). L'application ne réclame, à l'ouverture, que
--   pour un compte qui a accepté les notifications sur cet appareil ; activer
--   depuis l'écran réclame toujours ;
-- - réclamé à un autre compte : l'ancienne ligne part, avec les envois du
--   précédent — ils ne doivent pas s'afficher sur l'écran verrouillé du
--   suivant. C'est pour cela qu'on ne change pas simplement son propriétaire.
--
-- Rend vrai si l'appareil est, en sortant, inscrit pour l'appelant.
--
-- « claim » vaut vrai par défaut : l'agent de service, qui renouvelle un
-- abonnement déjà voulu, ne sait pas le dire, et une version en cache de
-- l'application non plus.
drop function public.register_push_subscription(text, text, text);
create function public.register_push_subscription(
  device_endpoint text,
  device_p256dh text,
  device_auth text,
  claim boolean default true
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); org uuid;
begin
  if caller is null then raise exception 'Aucune session ouverte.'; end if;
  select m.organization_id into org from public.memberships m
    where m.user_id = caller and m.active limit 1;
  if org is null then raise exception 'Compte rattaché à aucun centre actif.'; end if;

  if not claim then
    update public.push_subscriptions set organization_id = org, p256dh = device_p256dh, auth = device_auth
     where endpoint = device_endpoint and user_id = caller;
    return found;
  end if;

  -- « on conflict » plutôt qu'une lecture suivie d'une écriture : l'écran du
  -- profil et l'invitation redisent l'abonnement au même instant, et deux
  -- inscriptions simultanées butaient sur l'unicité de l'adresse.
  insert into public.push_subscriptions as s (organization_id, user_id, endpoint, p256dh, auth)
    values (org, caller, device_endpoint, device_p256dh, device_auth)
    on conflict (endpoint) do update
      set organization_id = excluded.organization_id, p256dh = excluded.p256dh, auth = excluded.auth
      where s.user_id = excluded.user_id;
  if found then return true; end if;

  delete from public.push_subscriptions where endpoint = device_endpoint;
  insert into public.push_subscriptions(organization_id, user_id, endpoint, p256dh, auth)
    values (org, caller, device_endpoint, device_p256dh, device_auth);
  return true;
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, boolean) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. La republication prévient aussi ceux qu'elle retire.
-- ---------------------------------------------------------------------------
--
-- Le corps est repris de 20260921140000 ; seul l'avis aux agents retirés
-- s'ajoute. Il reprend le type SCHEDULE_PUBLISHED : le texte poussé — « Votre
-- planning a été publié ou modifié » — et le lien de l'email conviennent, et le
-- sujet nomme la garde. Une seule notification, donc un seul événement pour les
-- trois canaux : le centre de messages, l'email et le téléphone.
--
-- Pas d'avis quand l'agent a obtenu un désistement depuis la version
-- précédente : la réponse lui a déjà dit « Vous n'êtes plus attendu sur cette
-- garde ». Pas d'avis non plus à un membre désactivé, qui ne lit plus rien.
create or replace function private.publish_schedule_shift(shift uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  sch public.schedules;
  req public.staffing_requirements;
  campaign uuid;
  retained integer;
  missing text;
  refused text;
  next_revision integer;
begin
  select * into s from public.schedule_shifts where id = shift for update;
  if s.id is null then raise exception 'Unknown shift'; end if;
  select * into sch from public.schedules where id = s.schedule_id;
  if not private.can_manage(sch.organization_id, sch.team_id) then
    raise exception 'Not allowed to publish this schedule';
  end if;
  campaign := sch.campaign_id;

  select count(*) into retained from public.schedule_assignments a
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED';

  -- Never derive an assignment from an availability: check they still agree.
  if exists (
    select 1 from public.schedule_assignments a
     where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
       and not exists (
         select 1 from public.availability_entries e
         join public.campaign_participants p on p.campaign_id = e.campaign_id and p.user_id = e.user_id
         where e.campaign_id = campaign and e.user_id = a.user_id and e.date = s.date
           and p.validated_at is not null
           and e.availability_type in (s.shift_code, 'FULL_24H')
       )
  ) then
    raise exception 'Every assignment needs a validated matching availability';
  end if;

  -- Un agent sorti de l'effectif n'est plus affectable, quelles que soient les
  -- disponibilités qu'il avait validées avant son départ.
  select string_agg(coalesce(p.display_name, a.user_id::text), ', ') into refused
    from public.schedule_assignments a
    left join public.profiles p on p.user_id = a.user_id
    left join public.memberships m
      on m.organization_id = sch.organization_id and m.user_id = a.user_id
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     and coalesce(m.active, false) = false;
  if refused is not null then raise exception 'Inactive members cannot be published: %', refused; end if;

  -- Un désistement accepté depuis l'affectation : remplacer, ou réaffecter
  -- explicitement. Publier tel quel contredirait la réponse faite à l'agent.
  select string_agg(coalesce(p.display_name, a.user_id::text), ', ') into refused
    from public.schedule_assignments a
    left join public.profiles p on p.user_id = a.user_id
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     and private.withdrew_from(shift, a.user_id, a.assigned_at);
  if refused is not null then raise exception 'Accepted withdrawal still assigned: %', refused; end if;

  select * into req from public.staffing_requirements
   where campaign_id = campaign and date = s.date and shift_code = s.shift_code;
  if req.id is null then raise exception 'Define the staffing requirement before publishing'; end if;
  if retained < req.headcount then
    raise exception 'Headcount not covered: % of %', retained, req.headcount;
  end if;

  select string_agg(q.name, ', ') into missing
    from public.staffing_requirement_qualifications rq
    join public.qualifications q on q.id = rq.qualification_id
   where rq.requirement_id = req.id
     and rq.minimum > (
       select count(*) from public.schedule_assignments a
       join public.user_qualifications uq on uq.user_id = a.user_id and uq.qualification_id = rq.qualification_id
       where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     );
  if missing is not null then raise exception 'Qualifications not covered: %', missing; end if;

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

  return next_revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. La fiche d'un agent actif ailleurs n'est plus à l'ancien centre.
-- ---------------------------------------------------------------------------
--
-- La fiche est globale : un nom, un téléphone, pour tous les centres. Le
-- centre où l'agent est actif en répond ; celui qu'il a quitté la gardait
-- modifiable parce que « Réactiver » en avait besoin (20260922100000). Or
-- réactiver un agent actif ailleurs est impossible — un seul rattachement
-- actif par compte, depuis 20260922150000 —, si bien que ce droit ne servait
-- plus qu'à écrire chez un autre. La fiche d'un membre désactivé qui n'est
-- actif nulle part reste modifiable, et réactivable, comme avant.
--
-- « security definer » : les rattachements de l'autre centre sont invisibles à
-- l'appelant, et la question posée sous ses policies répondrait toujours non.
--
-- La lecture, elle, ne change pas : l'ancien centre continue de voir le nom de
-- l'agent sur les gardes qu'il a tenues chez lui.
create function private.active_elsewhere(member uuid, org uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = member and m.active and m.organization_id <> org
  );
$$;
revoke all on function private.active_elsewhere(uuid, uuid) from public, anon;
-- Appelée par une policy, donc sous la session : comme active_administrators().
grant execute on function private.active_elsewhere(uuid, uuid) to authenticated;

drop policy profile_admin_write on public.profiles;
create policy profile_admin_write on public.profiles for update to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and private.can_administer(m.organization_id)
         and not private.active_elsewhere(m.user_id, m.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and private.can_administer(m.organization_id)
         and not private.active_elsewhere(m.user_id, m.organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Une clé par message, que Resend reconnaît.
-- ---------------------------------------------------------------------------
--
-- Resend garde vingt-quatre heures la réponse faite à une clé : le même
-- message renvoyé sous la même clé ne repart pas. La clé reste donc la même
-- tant que l'on ne sait pas si le message est parti — bail expiré, délai
-- dépassé, réseau coupé, envoi concurrent encore en cours.
--
-- Elle change quand Resend a répondu qu'il n'avait rien envoyé : 5xx, 429, ou
-- 409 pour un contenu qui a changé depuis la première tentative — une adresse
-- corrigée entre deux essais. Resend ne dit pas s'il garde aussi une réponse
-- d'échec : sans ce changement, une panne passagère pourrait se voir rendue
-- à chaque nouvel essai, jusqu'à l'abandon.
--
-- Le 409 n'est plus un refus définitif, pour la même raison. Le serveur
-- traduit en silence (0) le 409 qui signale un envoi concurrent : la clé reste,
-- et l'essai suivant reçoit la réponse du premier.
alter table public.notifications add column email_key uuid not null default gen_random_uuid();

drop function public.claim_email_deliveries(integer);
-- Le corps de 20260923200000, qui rend en plus la clé.
create function public.claim_email_deliveries(batch integer default 10) returns table (
  id uuid, lease uuid, idempotency_key uuid, email text, kind text, subject text, body text
) language plpgsql security invoker set search_path = '' as $$
begin
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
revoke all on function public.claim_email_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_email_deliveries(integer) to service_role;

-- Le corps de 20260922150000 : le 409 reprend au lieu d'abandonner, et la clé
-- change quand Resend a dit n'avoir rien envoyé.
create or replace function public.finish_email_delivery(delivery uuid, token uuid, http_status integer)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.notifications n set
    email_status = case
      when http_status between 200 and 299 then 'sent'
      when n.email_attempts >= 5 or (http_status between 400 and 499 and http_status not in (409, 429)) then 'failed'
      else 'pending' end,
    sent_at = case when http_status between 200 and 299 then now() else n.sent_at end,
    email_last_status = http_status, email_lease = null,
    email_available_at = now() + make_interval(secs => 60 * power(2, n.email_attempts)::integer),
    email_key = case when http_status >= 500 or http_status in (409, 429) then gen_random_uuid() else n.email_key end
   where n.id = delivery and n.email_lease = token and n.email_status = 'sending';
end;
$$;

commit;
