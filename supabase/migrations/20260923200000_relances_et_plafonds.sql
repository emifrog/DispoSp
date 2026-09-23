-- C8 et C9 de l'analyse du 23 septembre 2026 : ce que la migration
-- 20260923140000 annonçait sans le tenir.
--
-- 1. Les relances. `remind_campaign` gardait la règle de 0006 — pas de rappel
--    tant que le précédent n'est pas parti par email —, alors que `sent_at` ne
--    se pose qu'après un email réussi : sans Resend, le second rappel ne créait
--    plus rien, pas même dans l'application ; avec Resend, un agent dont
--    l'email avait échoué n'était plus jamais relancé. La limite de douze heures
--    la remplace. Une campagne close ne se relance plus, et un agent désactivé
--    n'est plus visé.
--
-- 2. Les invitations. Le journal des envois partait en cascade avec
--    l'invitation : la supprimer puis la recréer remettait tout à zéro, et le
--    message d'erreur le conseillait. Il est désormais tenu par adresse, et
--    survit à l'invitation. Le plafond du centre compte des envois, non plus des
--    invitations distinctes.
--
-- 3. Les emails en général. Un agent qui se désiste puis retire sa demande, en
--    boucle, faisait écrire à tout l'encadrement à chaque tour ; une campagne
--    créée ou un créneau republié écrit à toute l'équipe. Deux garde-fous : une
--    demande refaite dans les douze heures ne renotifie pas, et personne ne
--    reçoit plus de dix emails par heure — les suivants attendent, ils ne sont
--    pas perdus. Un membre désactivé ne reçoit plus d'email du tout.
--
-- S'applique par-dessus 20260923180000. À coller en entier.
begin;

do $$
begin
  if to_regproc('public.release_invitation_send') is null then
    raise exception 'Appliquez d''abord 20260923180000_rendre_envoi_invitation.sql';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'private' and table_name = 'invitation_sends' and column_name = 'email'
  ) then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Relances.
-- ---------------------------------------------------------------------------

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
     where p.campaign_id = campaign and p.validated_at is null;
  get diagnostics created = row_count;
  if created > 0 then
    insert into private.campaign_reminders (campaign_id, recipients) values (campaign, created);
  end if;
  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Invitations : un journal par adresse.
-- ---------------------------------------------------------------------------

alter table private.invitation_sends add column email text;
update private.invitation_sends s set email = i.email from public.invitations i where i.id = s.invitation_id;
alter table private.invitation_sends alter column email set not null;
-- L'invitation peut disparaître, son envoi reste compté.
alter table private.invitation_sends alter column invitation_id drop not null;
alter table private.invitation_sends drop constraint invitation_sends_invitation_id_fkey;
alter table private.invitation_sends
  add constraint invitation_sends_invitation_id_fkey
  foreign key (invitation_id) references public.invitations(id) on delete set null;
create index invitation_sends_address_idx on private.invitation_sends (organization_id, email, sent_at);

-- Les limites portent sur l'adresse et sur le centre, jamais sur l'identifiant
-- d'une invitation qu'on peut effacer et refaire.
create or replace function public.reserve_invitation_send(invitation uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  i public.invitations;
begin
  select * into i from public.invitations where id = invitation for update;
  if i.id is null or not private.can_administer(i.organization_id) then
    raise exception 'Unknown invitation';
  end if;
  if i.accepted_at is not null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('invitation_sends:' || i.organization_id::text));

  if exists (
    select 1 from private.invitation_sends s
     where s.organization_id = i.organization_id and s.email = i.email
       and s.sent_at > now() - interval '15 minutes'
  ) then
    raise exception 'Invitation sent too recently';
  end if;
  if (
    select count(*) from private.invitation_sends s
     where s.organization_id = i.organization_id and s.email = i.email
       and s.sent_at > now() - interval '24 hours'
  ) >= 5 then
    raise exception 'Invitation send limit reached';
  end if;
  if (
    select count(*) from private.invitation_sends s
     where s.organization_id = i.organization_id and s.sent_at > now() - interval '1 hour'
  ) >= 50 then
    raise exception 'Too many invitations sent';
  end if;

  insert into private.invitation_sends (invitation_id, organization_id, email)
    values (i.id, i.organization_id, i.email);
  return i.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Emails : une demande refaite ne renotifie pas ; dix par heure et par
--    destinataire ; rien pour un membre désactivé.
-- ---------------------------------------------------------------------------

-- Le corps de 20260919200000, plus la garde en tête de l'insertion.
create or replace function private.notify_withdrawal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  who text;
  quand text;
  creneau text;
begin
  select * into s from public.schedule_shifts where id = new.schedule_shift_id;
  if s.id is null then return null; end if;
  quand := to_char(s.date, 'DD/MM/YYYY');
  creneau := case when s.shift_code = 'DAY' then 'de jour' else 'de nuit' end;
  select coalesce(p.display_name, 'Un agent') into who
    from public.profiles p where p.user_id = new.user_id;

  if TG_OP = 'INSERT' then
    -- La même garde, demandée de nouveau dans les douze heures — après un
    -- retrait, typiquement : l'encadrement a déjà été prévenu, et la demande
    -- figure dans l'écran Demandes. Sans cette garde, désister puis retirer en
    -- boucle écrivait à tout l'encadrement à chaque tour.
    if exists (
      select 1 from public.shift_withdrawals w
       where w.user_id = new.user_id and w.schedule_shift_id = new.schedule_shift_id
         and w.id <> new.id and w.created_at > now() - interval '12 hours'
    ) then
      return null;
    end if;
    -- Tous ceux qui encadrent le centre : l'un d'eux réaffectera.
    insert into public.notifications (organization_id, user_id, kind, subject, body)
      select new.organization_id, m.user_id, 'WITHDRAWAL_REQUESTED',
             left(who || ' se désiste de la garde ' || creneau || ' du ' || quand, 200),
             case when new.reason = '' then 'Aucun motif indiqué.' else 'Motif : ' || new.reason end
        from public.memberships m
       where m.organization_id = new.organization_id and m.active
         and m.role in ('GESTIONNAIRE', 'ADMIN');
    return null;
  end if;

  if new.state in ('ACCEPTED', 'REFUSED') and old.state = 'PENDING' then
    insert into public.notifications (organization_id, user_id, kind, subject, body)
      values (
        new.organization_id, new.user_id, 'WITHDRAWAL_DECIDED',
        left('Désistement ' || case when new.state = 'ACCEPTED' then 'accepté' else 'refusé' end
             || ' — garde ' || creneau || ' du ' || quand, 200),
        case when new.state = 'ACCEPTED'
             then 'Vous n''êtes plus attendu sur cette garde. Le planning sera republié après réaffectation.'
             else 'Vous restez attendu sur cette garde. Rapprochez-vous de votre encadrement.' end
      );
  end if;
  return null;
end;
$$;

-- Le corps de 20260922150000, plus deux règles. Un membre désactivé n'est plus
-- écrit. Et chacun reçoit au plus dix emails par heure, en comptant ceux déjà
-- partis dans l'heure et ceux en cours d'envoi : au-delà, les messages restent
-- en file et partent à un passage suivant. Deux passages simultanés peuvent
-- dépasser le plafond d'un lot ; c'est un garde-fou, pas un compteur exact.
create or replace function public.claim_email_deliveries(batch integer default 50) returns table (
  id uuid, lease uuid, email text, kind text, subject text, body text
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
      returning n.id, n.email_lease, n.user_id, n.kind, n.subject, n.body
  ) select c.id, c.email_lease, p.email, c.kind, c.subject, c.body
      from claimed c join public.profiles p on p.user_id = c.user_id;
end;
$$;

commit;
