-- Correctifs C1, C2, C5 et C6 de l'analyse du 22 septembre 2026.
--
-- 1. Inviter une adresse déjà rattachée à un autre centre la rattachait sans
--    son accord, puis la verrouillait dehors : deux rattachements actifs, que
--    la lecture de session refuse. Reproduit. L'invitation est désormais
--    refusée, avec un message ; et un membre désactivé qu'on réinvite est
--    réactivé au lieu d'être marqué « accepté » sans rien changer.
--
-- 2. Le retrait d'un compte échouait dans trois cas courants : la clé
--    accepted_by des invitations violait sa contrainte à la suppression du
--    compte, l'invitation acceptée bloquait toute réinvitation, et les
--    désistements n'étaient jamais effacés. Les deux premiers se règlent ici,
--    le troisième dans le script.
--
-- 3. La file d'emails n'avait ni bail, ni tentatives, ni état : deux
--    gestionnaires qui publiaient ensemble envoyaient chaque message deux fois,
--    une adresse refusée bloquait tout le centre, et un agent qui se désistait
--    n'avait personne pour déclencher l'envoi. Elle prend le modèle de la file
--    poussée : réservation sous verrou, bail, tentatives, et un serveur qui la
--    vide après chaque commande, pour tous les centres.
--
-- S'applique par-dessus 20260922100000. À coller en entier.
begin;

do $$
begin
  if to_regproc('private.active_administrators') is null then
    raise exception 'Appliquez d''abord 20260922100000_reactivation_administrateur_devalidation.sql';
  end if;
  if to_regproc('public.claim_email_deliveries') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Un compte, un centre actif.
-- ---------------------------------------------------------------------------
--
-- Tant que la lecture de session ne sait pas choisir entre deux centres, deux
-- rattachements actifs sont un compte qui ne peut plus se connecter nulle part.
-- La contrainte le dit tout de suite, au lieu de le laisser découvrir à la
-- connexion suivante. Différée : la bascule d'essai vers un vrai centre
-- rattache d'abord, efface ensuite, dans la même transaction.
alter table public.memberships
  add constraint memberships_one_active_per_user exclude (user_id with =) where (active) deferrable initially deferred;

-- Le corps commun du rattachement. Un membre désactivé du même centre revient
-- actif, dans l'équipe et avec le rôle de l'invitation — c'est le déclencheur
-- de 0004 qui juge du rôle, sous la session de qui invite.
create or replace function private.attach_invited(invitation public.invitations, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name, grade, fonction, matricule, phone)
    values (member, invitation.display_name, invitation.grade, invitation.fonction,
            invitation.matricule, invitation.phone)
    on conflict (user_id) do nothing;
  insert into public.memberships as m (organization_id, user_id, team_id, role, active)
    values (invitation.organization_id, member, invitation.team_id, invitation.role, true)
    on conflict (organization_id, user_id) do update
      set active = true, team_id = excluded.team_id, role = excluded.role
      where not m.active;
  update public.invitations set accepted_at = now(), accepted_by = member where id = invitation.id;
end;
$$;

-- Chemin 2 : l'invitation arrive après le compte. Un compte actif ailleurs
-- n'est pas rattaché : on refuse l'invitation, et le message dit pourquoi.
create or replace function private.accept_invitation_now() returns trigger
language plpgsql security definer set search_path = '' as $$
declare existing uuid;
begin
  select u.id into existing from auth.users u
   where lower(btrim(u.email)) = new.email and u.email_confirmed_at is not null
   limit 1;
  if existing is null then return null; end if;
  if exists (
    select 1 from public.memberships m
     where m.user_id = existing and m.active and m.organization_id <> new.organization_id
  ) then
    raise exception 'Account already belongs to another organisation';
  end if;
  perform private.attach_invited(new, existing);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Ce que le retrait d'un compte doit pouvoir défaire.
-- ---------------------------------------------------------------------------

-- « on delete set null » sur accepted_by violait la contrainte qui lie
-- accepted_at et accepted_by : supprimer le compte d'un agent arrivé par
-- invitation échouait. Restrict, et c'est le script de retrait qui efface la
-- ligne, explicitement.
alter table public.invitations drop constraint invitations_accepted_by_fkey;
alter table public.invitations
  add constraint invitations_accepted_by_fkey foreign key (accepted_by) references auth.users(id) on delete restrict;

-- Une seule invitation en attente par adresse et par centre ; une invitation
-- acceptée, elle, n'empêche plus d'en refaire une — un agent retiré se réinvite.
alter table public.invitations drop constraint invitations_organization_id_email_key;
create unique index invitations_pending_email_key on public.invitations (organization_id, email)
  where accepted_at is null;

-- ---------------------------------------------------------------------------
-- 3. La file d'emails, sur le modèle de la file poussée.
-- ---------------------------------------------------------------------------

alter table public.notifications
  add column email_status text not null default 'pending'
    check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  add column email_attempts integer not null default 0,
  add column email_available_at timestamptz not null default now(),
  add column email_lease uuid,
  add column email_last_status integer;
update public.notifications set email_status = 'sent' where sent_at is not null;
create index notifications_email_queue_idx on public.notifications (email_available_at)
  where email_status in ('pending', 'sending');

-- Réserve un lot pour le serveur, tous centres confondus. Une notification
-- sans adresse — profil sans email — est écartée d'emblée : elle ne partira
-- jamais, autant ne pas la réessayer cinq fois. Le bail est de deux minutes ;
-- au-delà, un passage interrompu rend sa réservation.
create function public.claim_email_deliveries(batch integer default 50) returns table (
  id uuid, lease uuid, email text, kind text, subject text, body text
) language plpgsql security invoker set search_path = '' as $$
begin
  update public.notifications n set email_status = 'skipped'
    where n.email_status in ('pending', 'sending')
      and not exists (select 1 from public.profiles p where p.user_id = n.user_id and p.email is not null);
  update public.notifications n set email_status = 'failed'
    where n.email_status in ('pending', 'sending') and n.email_attempts >= 5 and n.email_available_at <= now();
  return query
  with selected as (
    select n.id from public.notifications n
     where n.email_status in ('pending', 'sending') and n.email_available_at <= now() and n.email_attempts < 5
     order by n.created_at, n.id limit greatest(1, least(batch, 200)) for update skip locked
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

-- Le résultat d'un envoi. 2xx : parti. 4xx hors 429 : ne partira jamais, on
-- n'insiste pas. Le reste — 429, 5xx, réseau — reprend plus tard, avec un délai
-- qui double à chaque tentative.
create function public.finish_email_delivery(delivery uuid, token uuid, http_status integer)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.notifications n set
    email_status = case
      when http_status between 200 and 299 then 'sent'
      when n.email_attempts >= 5 or (http_status between 400 and 499 and http_status <> 429) then 'failed'
      else 'pending' end,
    sent_at = case when http_status between 200 and 299 then now() else n.sent_at end,
    email_last_status = http_status, email_lease = null,
    email_available_at = now() + make_interval(secs => 60 * power(2, n.email_attempts)::integer)
   where n.id = delivery and n.email_lease = token and n.email_status = 'sending';
end;
$$;
revoke all on function public.claim_email_deliveries(integer) from public, anon, authenticated;
revoke all on function public.finish_email_delivery(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_email_deliveries(integer) to service_role;
grant execute on function public.finish_email_delivery(uuid, uuid, integer) to service_role;

-- Les deux fonctions de 0006 restent joignables par une session d'encadrement,
-- mais parlent le même état que la file : elles ne rendent pas ce qui est en
-- cours d'envoi ou abandonné, et marquer envoyé se voit des deux côtés.
create or replace function public.pending_notifications(org uuid, batch integer default 50)
returns table (id uuid, email text, kind text, subject text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_send(org) then return; end if;
  return query
    select n.id, p.email, n.kind, n.subject, n.body
      from public.notifications n
      join public.profiles p on p.user_id = n.user_id
     where n.organization_id = org and n.sent_at is null and n.email_status = 'pending' and p.email is not null
     order by n.created_at
     limit greatest(1, least(batch, 200));
end;
$$;

create or replace function public.mark_notifications_sent(ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare touched integer;
begin
  update public.notifications n set sent_at = now(), email_status = 'sent', email_lease = null
   where n.id = any(ids) and n.sent_at is null and private.can_send(n.organization_id);
  get diagnostics touched = row_count;
  return touched;
end;
$$;

commit;
