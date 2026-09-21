begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  endpoint text not null unique check (length(endpoint) <= 2048 and endpoint ~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/[^[:space:]]+$'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete cascade
);
create index push_subscriptions_member_idx on public.push_subscriptions(organization_id,user_id);
alter table public.push_subscriptions enable row level security;
create policy push_read on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_insert on public.push_subscriptions for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.memberships m where m.organization_id=push_subscriptions.organization_id and m.user_id=(select auth.uid()) and m.active)
);
create policy push_update on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid()) and exists (select 1 from public.memberships m where m.organization_id=push_subscriptions.organization_id and m.user_id=(select auth.uid()) and m.active)
);
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant update (p256dh, auth) on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- Une notification produit au plus un envoi par appareil déjà abonné.
-- Aucun rattrapage des anciennes notifications lors de l'activation.
create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','suppressed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_status integer,
  unique (notification_id,subscription_id)
);
create index push_deliveries_pending_idx on public.push_deliveries(available_at) where status in ('pending','sending');
create index push_deliveries_subscription_idx on public.push_deliveries(subscription_id);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
grant all on public.push_deliveries to service_role;

create function private.enqueue_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.push_deliveries(notification_id,subscription_id)
    select new.id,s.id from public.push_subscriptions s
    join public.memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id and m.active
    where s.organization_id=new.organization_id and s.user_id=new.user_id;
  return new;
end;
$$;
revoke all on function private.enqueue_push() from public,anon,authenticated;
create trigger enqueue_push after insert on public.notifications for each row execute function private.enqueue_push();

-- Pas de droit ajouté : les fonctions de traitement ne sont exécutables que
-- par le service serveur. Le verrou SKIP LOCKED empêche deux lots concurrents
-- de réserver le même envoi. Le bail permet la reprise après interruption.
create function public.claim_push_deliveries() returns table (
  id uuid, lease uuid, subscription_id uuid, endpoint text, p256dh text, auth text, notification_id uuid, kind text
) language plpgsql security invoker set search_path='' as $$
begin
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

create function public.finish_push_delivery(delivery uuid, token uuid, http_status integer)
returns void language plpgsql security invoker set search_path='' as $$
declare sub uuid;
begin
  select d.subscription_id into sub from public.push_deliveries d
    where d.id=delivery and d.lease=token and d.status='sending' for update;
  if sub is null then return; end if;
  if http_status in (404,410) then
    delete from public.push_subscriptions where id=sub;
    return;
  end if;
  update public.push_deliveries set
    status=case when http_status between 200 and 299 then 'sent'
      when attempts>=5 or (http_status between 400 and 499 and http_status<>429) then 'failed' else 'pending' end,
    sent_at=case when http_status between 200 and 299 then now() else null end,
    last_status=http_status,lease=null,
    available_at=now()+make_interval(secs=>60*power(2,attempts)::integer)
    where id=delivery;
end;
$$;
revoke all on function public.claim_push_deliveries() from public,anon,authenticated;
revoke all on function public.finish_push_delivery(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries() to service_role;
grant execute on function public.finish_push_delivery(uuid,uuid,integer) to service_role;
commit;
