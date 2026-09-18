-- 0005 — Une notification à l'ouverture d'une campagne.
-- Applies on top of 0004_agent_administration.sql. Not re-runnable: it creates objects.
-- Paste it whole; the transaction below rolls the migration back on any error.
begin;

do $$
begin
  if to_regclass('public.invitations') is null then
    raise exception 'Apply 0004_agent_administration.sql first: public.invitations is missing';
  end if;
  if to_regproc('private.notify_campaign_opened') is not null then
    raise exception '0005 has already been applied to this database';
  end if;
end
$$;

-- §10 asks for three moments: opening a campaign, a reminder before it closes,
-- and publishing a schedule. Publication already writes its own rows from
-- private.publish_schedule_shift(). This adds the opening. The reminder needs a
-- clock nobody runs yet, and it goes with the email sending.
--
-- A definer function, so the rows are written by the engine: authenticated holds
-- no insert right on notifications, only the right to mark its own as read.
create function private.notify_campaign_opened() returns trigger
language plpgsql security definer set search_path = '' as $$
declare campaign public.availability_campaigns;
begin
  select * into campaign from public.availability_campaigns where id = new.campaign_id;
  if campaign.id is null then return null; end if;
  insert into public.notifications (organization_id, user_id, kind, subject, body)
    values (
      new.organization_id,
      new.user_id,
      'CAMPAIGN_OPENED',
      left('Campagne ouverte : ' || campaign.name, 200),
      -- The window is a timestamp in the table and a day for the person reading.
      'Renseignez vos disponibilités avant le '
        || to_char(campaign.closes_at at time zone 'Europe/Paris', 'DD/MM/YYYY')
        || ', puis validez votre réponse.'
    );
  return null;
end;
$$;
revoke all on function private.notify_campaign_opened() from public;

-- Being invited to a campaign is what opening one means for an agent: the same
-- insert that makes them a participant is the moment they should hear about it.
create trigger notify_campaign_opened after insert on public.campaign_participants
  for each row execute function private.notify_campaign_opened();

commit;
