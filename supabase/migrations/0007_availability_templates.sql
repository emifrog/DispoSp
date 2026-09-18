-- 0007 — La disponibilité habituelle du §4, réutilisable d'une campagne à l'autre.
-- Applies on top of 0006_email_dispatch.sql. Not re-runnable: it creates objects.
-- Paste it whole; the transaction below rolls the migration back on any error.
begin;

do $$
begin
  if to_regproc('public.pending_notifications') is null then
    raise exception 'Apply 0006_email_dispatch.sql first: public.pending_notifications is missing';
  end if;
  if to_regclass('public.availability_templates') is not null then
    raise exception '0007 has already been applied to this database';
  end if;
end
$$;

-- Un modèle, pas une disponibilité : rien ici n'entre dans une couverture ni
-- dans un planning tant que l'agent ne l'a pas appliqué à une campagne, ce qui
-- écrit alors de vraies lignes dans availability_entries.
--
-- La semaine est numérotée comme ISO 8601 : 1 = lundi, 7 = dimanche.
create table public.availability_templates (
  organization_id uuid not null,
  user_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  availability_type text not null check (availability_type in ('DAY', 'NIGHT', 'FULL_24H', 'UNAVAILABLE')),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, weekday),
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete restrict
);

alter table public.availability_templates enable row level security;

-- Le modèle de quelqu'un ne regarde que lui : il ne dit pas ce qu'il fera, mais
-- ce qu'il fait d'habitude, et aucun écran de pilotage n'en a besoin.
create policy template_own on public.availability_templates for all to authenticated
  using (user_id = (select auth.uid()) and private.is_member(organization_id))
  with check (user_id = (select auth.uid()) and private.is_member(organization_id));

revoke all on public.availability_templates from anon, authenticated;
grant select, insert, delete on public.availability_templates to authenticated;
grant update (availability_type, updated_at) on public.availability_templates to authenticated;

commit;
