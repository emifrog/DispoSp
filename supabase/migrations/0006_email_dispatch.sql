-- 0006 — L'adresse des agents, la file d'envoi, et le rappel avant clôture.
-- Applies on top of 0005_notifications.sql. Not re-runnable: it creates objects.
-- Paste it whole; the transaction below rolls the migration back on any error.
begin;

do $$
begin
  if to_regproc('private.notify_campaign_opened') is null then
    raise exception 'Apply 0005_notifications.sql first: private.notify_campaign_opened is missing';
  end if;
  if to_regproc('public.pending_notifications') is not null then
    raise exception '0006 has already been applied to this database';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The address, §3 of the specification.
-- ---------------------------------------------------------------------------

-- Held by auth.users, which PostgREST does not expose: without a copy the
-- application knows nobody's address. Kept in step by a trigger rather than by
-- hand, and never client-writable — the authority stays with the auth schema.
alter table public.profiles
  add column email text check (email is null or position('@' in email) > 1);

update public.profiles p set email = u.email from auth.users u where u.id = p.user_id;

create function private.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where user_id = new.id;
  return null;
end;
$$;
revoke all on function private.sync_profile_email() from public;
create trigger sync_profile_email after insert or update of email on auth.users
  for each row execute function private.sync_profile_email();

-- A profile is always created after its auth.users row — by accept_invitation(),
-- by the provisioning script, by hand — so the trigger above has already fired
-- and found nothing to update. Filling it on the way in covers every path at
-- once, instead of teaching each one to remember.
create function private.fill_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null then
    select u.email into new.email from auth.users u where u.id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function private.fill_profile_email() from public;
create trigger fill_profile_email before insert on public.profiles
  for each row execute function private.fill_profile_email();

-- ---------------------------------------------------------------------------
-- 2. The outbox.
-- ---------------------------------------------------------------------------

-- A notification is written the moment it is earned; sending is a separate act
-- that may fail, be retried, or never happen at all. Two columns, two lives:
-- read_at belongs to the recipient, sent_at to the dispatcher.
alter table public.notifications add column sent_at timestamptz;
create index notifications_pending_idx on public.notifications(organization_id) where sent_at is null;

create function private.can_send(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m
     where m.organization_id = org and m.user_id = auth.uid() and m.active
       and m.role in ('RESPONSABLE', 'GESTIONNAIRE', 'ADMIN')
  );
$$;
revoke all on function private.can_send(uuid) from public;
grant execute on function private.can_send(uuid) to authenticated;

-- Reading the queue means reading other people's notices and addresses, which
-- no policy allows and none should. A definer function, narrow on purpose: it
-- returns nothing to anyone who does not manage the centre.
create function public.pending_notifications(org uuid, batch integer default 50)
returns table (id uuid, email text, kind text, subject text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_send(org) then return; end if;
  return query
    select n.id, p.email, n.kind, n.subject, n.body
      from public.notifications n
      join public.profiles p on p.user_id = n.user_id
     where n.organization_id = org and n.sent_at is null and p.email is not null
     order by n.created_at
     limit greatest(1, least(batch, 200));
end;
$$;
revoke all on function public.pending_notifications(uuid, integer) from public, anon;
grant execute on function public.pending_notifications(uuid, integer) to authenticated;

create function public.mark_notifications_sent(ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare touched integer;
begin
  update public.notifications n set sent_at = now()
   where n.id = any(ids) and n.sent_at is null and private.can_send(n.organization_id);
  get diagnostics touched = row_count;
  return touched;
end;
$$;
revoke all on function public.mark_notifications_sent(uuid[]) from public, anon;
grant execute on function public.mark_notifications_sent(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The reminder, §10.
-- ---------------------------------------------------------------------------

-- Nobody runs a clock yet, so the reminder is an act a manager takes: it aims at
-- the agents who have not validated, and at nobody else. Calling it twice the
-- same day adds nothing — one pending reminder per person and per campaign.
create function public.remind_campaign(campaign uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.availability_campaigns; created integer;
begin
  select * into c from public.availability_campaigns where id = campaign;
  if c.id is null or not private.can_manage(c.organization_id, c.team_id) then
    raise exception 'Not allowed to remind this campaign';
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
  return created;
end;
$$;
revoke all on function public.remind_campaign(uuid) from public, anon;
grant execute on function public.remind_campaign(uuid) to authenticated;

commit;
