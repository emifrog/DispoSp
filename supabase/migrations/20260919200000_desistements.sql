-- Désistements sur une garde publiée.
--
-- Un agent à qui une garde a été publiée signale qu'il ne peut plus la tenir.
-- Le gestionnaire répond, et c'est tout ce que cette table enregistre : la
-- demande et sa réponse.
--
-- Elle ne touche pas au planning, délibérément. Réaffecter passe par l'écran de
-- planning et par publish_schedule_shift(), qui refuse un créneau dont
-- l'effectif ou les qualifications ne sont plus couverts. Un désistement
-- accepté qui republierait tout seul créerait donc soit un trou interdit, soit
-- une seconde façon de modifier un planning publié. Il n'y en a qu'une.
--
-- S'applique par-dessus 20260919120000. À coller en entier.
begin;

do $$
begin
  if to_regclass('public.schedule_assignments') is null then
    raise exception 'Appliquez d''abord 0002_planning.sql : public.schedule_assignments est absente';
  end if;
  if to_regclass('public.shift_withdrawals') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. La demande.
-- ---------------------------------------------------------------------------

create table public.shift_withdrawals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  schedule_shift_id uuid not null,
  user_id uuid not null,
  reason text not null default '' check (length(reason) <= 500),
  state text not null default 'PENDING' check (state in ('PENDING', 'ACCEPTED', 'REFUSED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  -- Une décision a un auteur et une date, ou n'existe pas. « PENDING » et
  -- « CANCELLED » sont les deux états sans décideur : le second est le retrait
  -- par l'agent lui-même.
  check ((decided_at is null) = (decided_by is null)),
  check ((state in ('ACCEPTED', 'REFUSED')) = (decided_at is not null)),
  foreign key (organization_id, schedule_shift_id) references public.schedule_shifts(organization_id, id) on delete restrict,
  foreign key (organization_id, user_id) references public.memberships(organization_id, user_id) on delete restrict,
  foreign key (organization_id, decided_by) references public.memberships(organization_id, user_id) on delete restrict
);
-- Une seule demande ouverte à la fois par agent et par garde. Un index partiel
-- plutôt qu'une contrainte : une garde refusée puis redemandée reste possible.
create unique index shift_withdrawals_open_idx
  on public.shift_withdrawals(schedule_shift_id, user_id) where state = 'PENDING';
create index shift_withdrawals_org_idx on public.shift_withdrawals(organization_id, state, created_at desc);

-- Se désister d'une garde qu'on ne tient pas n'a pas de sens : la garde doit
-- être publiée, et l'agent doit figurer dans la révision publiée. Vérifié ici
-- et pas seulement à l'écran — c'est la base qui décide.
create function private.holds_published_shift(shift uuid, member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.schedule_shifts s
      join public.schedule_assignments a
        on a.schedule_shift_id = s.id and a.revision = s.published_revision
     where s.id = shift and s.published_revision > 0
       and a.user_id = member and a.status <> 'CANCELLED'
  );
$$;
revoke all on function private.holds_published_shift(uuid, uuid) from public;
grant execute on function private.holds_published_shift(uuid, uuid) to authenticated;

alter table public.shift_withdrawals enable row level security;

-- L'agent voit les siennes ; qui encadre voit celles de son centre.
create policy withdrawal_read on public.shift_withdrawals for select to authenticated
  using (user_id = (select auth.uid()) or private.can_administer(organization_id));

-- On ne se désiste que pour soi, et que d'une garde qu'on tient réellement.
create policy withdrawal_insert on public.shift_withdrawals for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and state = 'PENDING'
    and decided_at is null
    and private.is_member(organization_id)
    and private.holds_published_shift(schedule_shift_id, (select auth.uid()))
  );

-- Deux façons de faire évoluer une demande, et deux policies pour les séparer :
-- l'agent la retire, le gestionnaire la tranche.
create policy withdrawal_cancel on public.shift_withdrawals for update to authenticated
  using (user_id = (select auth.uid()) and state = 'PENDING')
  with check (user_id = (select auth.uid()) and state in ('PENDING', 'CANCELLED'));
create policy withdrawal_decide on public.shift_withdrawals for update to authenticated
  using (private.can_administer(organization_id) and state = 'PENDING')
  with check (private.can_administer(organization_id));

revoke all on public.shift_withdrawals from anon, authenticated;
grant select, insert on public.shift_withdrawals to authenticated;
grant update (state, decided_at, decided_by) on public.shift_withdrawals to authenticated;

-- Le décideur, c'est celui qui décide. La colonne est accessible en écriture,
-- donc rien n'empêcherait d'y écrire le nom d'un autre : ce déclencheur le
-- remplit lui-même et refuse qu'on le contredise.
create function private.stamp_withdrawal_decision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.state = old.state then return new; end if;
  if new.state in ('ACCEPTED', 'REFUSED') then
    new.decided_by := auth.uid();
    new.decided_at := now();
  elsif new.state = 'CANCELLED' then
    new.decided_by := null;
    new.decided_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_withdrawal_decision() from public;
create trigger stamp_withdrawal_decision before update on public.shift_withdrawals
  for each row execute function private.stamp_withdrawal_decision();

-- ---------------------------------------------------------------------------
-- 2. Les notifications qui vont avec.
-- ---------------------------------------------------------------------------

-- La contrainte de 0002 énumérait trois genres. Deux s'y ajoutent.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('CAMPAIGN_OPENED', 'CAMPAIGN_REMINDER', 'SCHEDULE_PUBLISHED',
                  'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_DECIDED'));

-- Definer : « authenticated » n'a aucun droit d'insertion sur notifications, et
-- ne doit pas en gagner. C'est le moteur qui écrit.
create function private.notify_withdrawal() returns trigger
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
revoke all on function private.notify_withdrawal() from public;
create trigger notify_withdrawal after insert or update of state on public.shift_withdrawals
  for each row execute function private.notify_withdrawal();

-- ---------------------------------------------------------------------------
-- 3. Journal d'audit.
-- ---------------------------------------------------------------------------

create function private.record_withdrawal_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare subject jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (
      (subject ->> 'organization_id')::uuid,
      auth.uid(),
      'shift_withdrawal',
      subject ->> 'id',
      case when TG_OP = 'INSERT' then 'CREATE' else coalesce(new.state, 'UPDATE') end,
      case when TG_OP = 'INSERT' then null else to_jsonb(old) end,
      to_jsonb(new)
    );
  return null;
end;
$$;
revoke all on function private.record_withdrawal_audit() from public;
create trigger audit_withdrawals after insert or update on public.shift_withdrawals
  for each row execute function private.record_withdrawal_audit();

commit;
