-- Point 6 de l'audit de déployabilité du 22 septembre 2026 : aucune limite
-- sur ce qui envoie des emails.
--
-- 1. Une invitation se renvoyait autant de fois qu'on cliquait, et un centre
--    pouvait en envoyer sans plafond. Chaque envoi part désormais d'une
--    réservation en base : un quart d'heure entre deux envois d'une même
--    invitation, cinq envois au plus par invitation, cinquante invitations
--    envoyées par heure et par centre.
--
-- 2. Un rappel de campagne n'était refusé que tant que le précédent attendait
--    dans la file. La file se vide en quelques secondes : chaque clic suivant
--    renvoyait un email à chaque agent qui n'avait pas validé. Un rappel par
--    campagne toutes les douze heures.
--
-- Les limites vivent ici et non dans le serveur Next : un hébergeur sans état
-- fait tourner plusieurs instances, et un compteur en mémoire n'en voit
-- qu'une. Un compte d'encadrement compromis passe par les mêmes actions.
--
-- S'applique par-dessus 20260923090000. À coller en entier.
begin;

do $$
begin
  if to_regproc('public.save_member') is null then
    raise exception 'Appliquez d''abord 20260923090000_fiche_agent_atomique.sql';
  end if;
  if to_regproc('public.reserve_invitation_send') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Invitations.
-- ---------------------------------------------------------------------------

-- Un journal plutôt qu'une colonne sur l'invitation : modifier l'invitation à
-- chaque envoi l'inscrirait à l'historique comme « modifiée ». Le schéma
-- private n'est pas exposé par l'API ; seules les fonctions y écrivent.
create table private.invitation_sends (
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  organization_id uuid not null,
  sent_at timestamptz not null default now()
);
create index invitation_sends_invitation_idx on private.invitation_sends (invitation_id, sent_at);
create index invitation_sends_organization_idx on private.invitation_sends (organization_id, sent_at);
revoke all on private.invitation_sends from public, anon, authenticated;

-- Rend l'adresse à laquelle envoyer, ou null si l'invitation est déjà acceptée
-- — le compte existait, le déclencheur l'a rattaché, rien ne doit partir.
-- Réserver n'envoie rien : seul le serveur tient la clé qui envoie. L'appeler
-- directement ne fait qu'user son propre quota.
create function public.reserve_invitation_send(invitation uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  i public.invitations;
begin
  -- Le verrou de ligne sérialise deux clics sur la même invitation ; le verrou
  -- consultatif, deux invitations du même centre face au plafond horaire.
  select * into i from public.invitations where id = invitation for update;
  if i.id is null or not private.can_administer(i.organization_id) then
    raise exception 'Unknown invitation';
  end if;
  if i.accepted_at is not null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('invitation_sends:' || i.organization_id::text));

  if exists (
    select 1 from private.invitation_sends s
     where s.invitation_id = i.id and s.sent_at > now() - interval '15 minutes'
  ) then
    raise exception 'Invitation sent too recently';
  end if;
  if (select count(*) from private.invitation_sends s where s.invitation_id = i.id) >= 5 then
    raise exception 'Invitation send limit reached';
  end if;
  if (
    select count(distinct s.invitation_id) from private.invitation_sends s
     where s.organization_id = i.organization_id and s.sent_at > now() - interval '1 hour'
  ) >= 50 then
    raise exception 'Too many invitations sent';
  end if;

  insert into private.invitation_sends (invitation_id, organization_id) values (i.id, i.organization_id);
  return i.email;
end;
$$;
revoke all on function public.reserve_invitation_send(uuid) from public, anon;
grant execute on function public.reserve_invitation_send(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rappels de campagne.
-- ---------------------------------------------------------------------------

create table private.campaign_reminders (
  campaign_id uuid not null references public.availability_campaigns(id) on delete cascade,
  reminded_at timestamptz not null default now(),
  recipients integer not null
);
create index campaign_reminders_campaign_idx on private.campaign_reminders (campaign_id, reminded_at);
revoke all on private.campaign_reminders from public, anon, authenticated;

-- Le corps de 0006, plus la limite. Un rappel qui ne touche personne — tout le
-- monde a validé — ne compte pas : il n'a rien envoyé.
create or replace function public.remind_campaign(campaign uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.availability_campaigns; created integer;
begin
  select * into c from public.availability_campaigns where id = campaign for update;
  if c.id is null or not private.can_manage(c.organization_id, c.team_id) then
    raise exception 'Not allowed to remind this campaign';
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
     where p.campaign_id = campaign and p.validated_at is null
       and not exists (
         select 1 from public.notifications n
          where n.user_id = p.user_id and n.kind = 'CAMPAIGN_REMINDER'
            and n.sent_at is null and n.subject = left('Rappel : ' || c.name, 200)
       );
  get diagnostics created = row_count;
  if created > 0 then
    insert into private.campaign_reminders (campaign_id, recipients) values (campaign, created);
  end if;
  return created;
end;
$$;

commit;
