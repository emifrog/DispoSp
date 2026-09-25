-- Points mineurs de l'analyse du 25 septembre 2026, tous reproduits sur une
-- base neuve (.local/audit-20260925/sql/open-items.test.ts).
--
-- 1. Un gestionnaire pouvait passer en CANCELLED la demande d'un agent. Retirer
--    une demande est le geste de l'agent : l'écran Demandes l'affichait comme
--    tel, et l'agent restait attendu sur une garde qu'il croyait en débat.
-- 2. pending_notifications() et mark_notifications_sent() restaient ouvertes à
--    toute session d'encadrement. L'application ne les appelle plus — la file
--    passe par claim_email_deliveries() et finish_email_delivery(), réservées
--    au serveur — mais un gestionnaire pouvait encore lire les avis en attente
--    de son centre et marquer la file envoyée : les emails ne partaient pas.
-- 3. save_member() et set_staffing_requirement() n'étaient retirées qu'à
--    PUBLIC. Sous les privilèges par défaut de Supabase, anon garde l'exécution
--    de toute fonction créée dans public, sauf à la lui retirer nommément.
-- 4. L'effectif d'un besoin pouvait descendre sous un minimum par
--    qualification par une mise à jour directe : le contrôle de 0002 ne
--    regardait que la table des minima. Le besoin devenait impossible à
--    couvrir, et la publication refusait sans que l'écran dise pourquoi.
-- 5. L'index d'une campagne par mois et par équipe portait sur la date de
--    début : une insertion directe au 2 novembre ouvrait un second novembre.
-- 6. set_staffing_requirement() prenait les noms de qualification tels quels :
--    « SAP » suivi d'une espace créait une qualification fantôme, que personne
--    ne détient, et le créneau ne se publiait plus.
--
-- S'applique par-dessus 20260925150000. À coller en entier.
begin;

do $$
begin
  if has_column_privilege('authenticated', 'public.shift_withdrawals', 'created_at', 'INSERT') then
    raise exception 'Appliquez d''abord 20260925150000_desistements_notification.sql';
  end if;
  if to_regproc('private.check_requirement_headcount') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
  -- Une campagne qui ne commence pas le premier du mois ferait échouer la
  -- contrainte sur un message obscur : on la nomme, pour qu'elle soit corrigée
  -- ou retirée avant de recommencer.
  if exists (select 1 from public.availability_campaigns where extract(day from starts_on) <> 1) then
    raise exception 'Appliquez cette migration après avoir corrigé la date de début : une campagne existante ne commence pas le premier du mois';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Trancher une demande, c'est l'accepter ou la refuser.
-- ---------------------------------------------------------------------------
--
-- La policy de 20260919200000 disait qui tranche et quoi, mais pas vers quel
-- état. withdrawal_cancel reste la seule voie vers CANCELLED, et elle ne
-- s'ouvre qu'à l'auteur de la demande.
drop policy withdrawal_decide on public.shift_withdrawals;
create policy withdrawal_decide on public.shift_withdrawals for update to authenticated
  using (private.can_administer(organization_id) and state = 'PENDING')
  with check (private.can_administer(organization_id) and state in ('ACCEPTED', 'REFUSED'));

-- ---------------------------------------------------------------------------
-- 2. L'ancienne file d'emails n'est plus joignable par une session.
-- ---------------------------------------------------------------------------
--
-- Les fonctions restent : 0007 vérifie leur présence, et les retirer n'apporte
-- rien de plus que de les fermer.
revoke execute on function public.pending_notifications(uuid, integer) from public, anon, authenticated;
revoke execute on function public.mark_notifications_sent(uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. anon, nommément.
-- ---------------------------------------------------------------------------
--
-- Sans conséquence aujourd'hui — les deux fonctions sont « invoker » et anon ne
-- détient aucun droit sur les tables —, mais une règle qui tient par accident
-- ne tient pas longtemps.
revoke execute on function public.save_member(uuid, uuid, uuid, text, boolean, text, text, text, text, text, text[])
  from anon;
revoke execute on function public.set_staffing_requirement(uuid, date, text, integer, jsonb) from anon;

-- ---------------------------------------------------------------------------
-- 4. L'effectif ne descend pas sous un minimum.
-- ---------------------------------------------------------------------------
--
-- Le pendant de check_requirement_minimum() : les deux côtés de la paire sont
-- désormais gardés. « security definer » pour lire tous les minima du besoin,
-- quelles que soient les policies de la session.
create function private.check_requirement_headcount() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.staffing_requirement_qualifications rq
     where rq.requirement_id = new.id and rq.minimum > new.headcount
  ) then
    raise exception 'Headcount is below a qualification minimum';
  end if;
  return new;
end;
$$;
revoke all on function private.check_requirement_headcount() from public, anon, authenticated;
create trigger requirement_headcount before update of headcount on public.staffing_requirements
  for each row execute function private.check_requirement_headcount();

-- ---------------------------------------------------------------------------
-- 5. Une campagne commence le premier du mois.
-- ---------------------------------------------------------------------------
--
-- create_campaign() l'exige déjà ; la base le tient désormais pour toute
-- écriture. L'index availability_campaigns_team_month_key garde son nom — c'est
-- lui que l'application reconnaît — et couvre ainsi le mois entier.
alter table public.availability_campaigns
  add constraint availability_campaigns_starts_on_first_day check (extract(day from starts_on) = 1);

-- ---------------------------------------------------------------------------
-- 4 et 6. set_staffing_requirement(), réécrite.
-- ---------------------------------------------------------------------------
--
-- Le corps est repris de 20260920090000. Deux changements :
--
-- - les minima partent avant que l'effectif change. Sans cela, baisser
--   l'effectif et un minimum d'un même geste buterait sur l'ancien minimum,
--   que le nouveau déclencheur verrait encore ;
-- - les noms sont débarrassés de leurs blancs, un nom vide est refusé, et deux
--   clés qui désignent la même qualification n'en font qu'une, au plus fort
--   des deux minima.
create or replace function public.set_staffing_requirement(
  campaign uuid,
  on_date date,
  shift text,
  total integer,
  minima jsonb
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  org uuid;
  req uuid;
  wanted jsonb;
begin
  select c.organization_id into org from public.availability_campaigns c where c.id = campaign;
  if org is null then raise exception 'Unknown campaign'; end if;

  if exists (select 1 from jsonb_object_keys(coalesce(minima, '{}'::jsonb)) as k(key) where btrim(k.key, E' \t\r\n') = '') then
    raise exception 'Qualification name is empty';
  end if;
  select coalesce(jsonb_object_agg(s.name, s.minimum), '{}'::jsonb) into wanted
    from (
      select btrim(m.key, E' \t\r\n') as name, max(m.value::int) as minimum
        from jsonb_each_text(coalesce(minima, '{}'::jsonb)) as m(key, value)
       where m.value::int > 0
       group by 1
    ) s;

  select r.id into req from public.staffing_requirements r
   where r.campaign_id = campaign and r.date = on_date and r.shift_code = shift;
  if req is not null then
    delete from public.staffing_requirement_qualifications where requirement_id = req;
  end if;

  insert into public.staffing_requirements (organization_id, campaign_id, date, shift_code, headcount)
    values (org, campaign, on_date, shift, total)
    on conflict (campaign_id, date, shift_code) do update set headcount = excluded.headcount
    returning id into req;

  -- Le catalogue se complète à mesure que les besoins se définissent, comme le
  -- faisait l'écriture précédente. Qui n'a pas le droit d'y ajouter une ligne
  -- se le verra refuser ici, et toute l'écriture sera annulée avec.
  insert into public.qualifications (organization_id, name)
    select org, m.key
      from jsonb_each_text(wanted) as m(key, value)
     where not exists (
         select 1 from public.qualifications q where q.organization_id = org and q.name = m.key
       );

  insert into public.staffing_requirement_qualifications (organization_id, requirement_id, qualification_id, minimum)
    select org, req, q.id, m.value::int
      from jsonb_each_text(wanted) as m(key, value)
      join public.qualifications q on q.organization_id = org and q.name = m.key;
end;
$$;

commit;
