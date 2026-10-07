-- B1 de l'audit de performance du 7 octobre 2026
-- (docs/AUDIT_PERFORMANCE_2026-10-07.md) : sur un centre de taille réelle,
-- chaque écran d'encadrement mettait vingt secondes à s'afficher, et la lecture
-- des affectations dépassait parfois le délai de huit secondes de la base.
--
-- Les règles de lecture et d'écriture testaient l'appartenance au centre par
-- private.is_member(), can_manage() et can_administer(). Ce sont des fonctions
-- « security definer » : PostgreSQL ne peut pas les fondre dans la requête, il
-- les appelle pour chaque ligne examinée, et chaque appel relit le jeton puis
-- memberships. Une page de 500 affectations triées oblige à examiner toute la
-- table : le coût de la lecture complète croissait comme le carré du volume
-- (14,6 s pour 10 360 affectations, mesuré sur la pile locale).
--
-- Ici, deux fonctions rendent **l'ensemble** des centres de l'appelant — ceux
-- où il est membre actif, ceux où il encadre —, et chaque règle teste
-- l'appartenance à cet ensemble. Écrit `x in (select …)`, l'ensemble se calcule
-- une fois par requête, et chaque ligne n'est plus qu'une recherche dans une
-- table de hachage (0,18 s pour les mêmes affectations).
--
-- Les droits ne changent pas. Chaque règle est réécrite telle quelle, seul
-- l'appel change :
-- - is_member(x)          → x in (select private.my_organizations())
-- - can_manage(x, équipe) → x in (select private.managed_organizations())
-- - can_administer(x)     → x in (select private.managed_organizations())
-- can_manage() ignore l'équipe depuis 20260919120000, et can_administer() porte
-- la même condition qu'elle (gestionnaire ou administrateur, actif) : les deux
-- deviennent le même ensemble. Sans session, les ensembles sont vides et les
-- règles refusent, comme avant.
--
-- Les trois anciennes fonctions restent : publish_schedule_shift(),
-- create_campaign(), remind_campaign() et reserve_invitation_send() s'en
-- servent pour un contrôle unique, où elles ne coûtent rien. Une règle nouvelle
-- ne doit plus les appeler ; database.test.ts le vérifie.
--
-- S'applique par-dessus 20261007090000. À coller en entier. Aucun code ne
-- dépend d'elle : elle s'applique avant ou après un déploiement.
begin;

do $$
begin
  if to_regproc('private.is_conduite') is null then
    raise exception 'Appliquez d''abord 20261007090000_conduite.sql';
  end if;
  if to_regproc('private.my_organizations') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- Les centres où l'appelant est membre actif : is_member(), pour tous à la fois.
create function private.my_organizations() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.organization_id from public.memberships m
   where m.user_id = (select auth.uid()) and m.active;
$$;
-- Ceux où il encadre : can_manage() et can_administer(), pour tous à la fois.
create function private.managed_organizations() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.organization_id from public.memberships m
   where m.user_id = (select auth.uid()) and m.active and m.role in ('GESTIONNAIRE', 'ADMIN');
$$;
revoke all on function private.my_organizations(), private.managed_organizations() from public, anon;
grant execute on function private.my_organizations(), private.managed_organizations() to authenticated;

-- Campagnes
alter policy campaign_read on public.availability_campaigns
  using (organization_id in (select private.my_organizations()));
alter policy campaign_insert on public.availability_campaigns
  with check (organization_id in (select private.managed_organizations()));
alter policy campaign_lock on public.availability_campaigns
  using (organization_id in (select private.managed_organizations()))
  with check (organization_id in (select private.managed_organizations()));

-- Disponibilité habituelle
alter policy template_own on public.availability_templates
  using (user_id = (select auth.uid()) and organization_id in (select private.my_organizations()))
  with check (user_id = (select auth.uid()) and organization_id in (select private.my_organizations()));

-- Participants aux campagnes
alter policy participant_read on public.campaign_participants
  using (
    (user_id = (select auth.uid()) and organization_id in (select private.my_organizations()))
    or exists (
      select 1 from public.availability_campaigns c
       where c.id = campaign_id and c.organization_id in (select private.managed_organizations())
    )
  );
alter policy participant_insert on public.campaign_participants
  with check (
    validated_at is null and exists (
      select 1 from public.availability_campaigns c
      join public.memberships m on m.organization_id = c.organization_id and m.team_id = c.team_id
      where c.id = campaign_id and m.user_id = campaign_participants.user_id and m.active
        and c.organization_id in (select private.managed_organizations())
    )
  );
alter policy participant_validate on public.campaign_participants
  using (user_id = (select auth.uid()) and organization_id in (select private.my_organizations()))
  with check (user_id = (select auth.uid()) and organization_id in (select private.my_organizations()));

-- Invitations
alter policy invitation_read on public.invitations
  using (organization_id in (select private.managed_organizations()));
alter policy invitation_write on public.invitations
  using (organization_id in (select private.managed_organizations()) and accepted_at is null)
  with check (
    organization_id in (select private.managed_organizations())
    and accepted_at is null
    and (role <> 'ADMIN' or private.is_administrator(organization_id))
  );

-- Appartenances
alter policy membership_read on public.memberships
  using ((user_id = (select auth.uid()) and active) or organization_id in (select private.managed_organizations()));
alter policy membership_write on public.memberships
  using (organization_id in (select private.managed_organizations()))
  with check (organization_id in (select private.managed_organizations()));

-- Centres
alter policy organization_read on public.organizations
  using (id in (select private.my_organizations()));
alter policy organization_hours on public.organizations
  using (id in (select private.managed_organizations()))
  with check (id in (select private.managed_organizations()));

-- Fiches
alter policy profile_team_read on public.profiles
  using (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and m.organization_id in (select private.managed_organizations())
    )
  );
alter policy profile_admin_write on public.profiles
  using (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and m.organization_id in (select private.managed_organizations())
         and not private.active_elsewhere(m.user_id, m.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.user_id and m.organization_id in (select private.managed_organizations())
         and not private.active_elsewhere(m.user_id, m.organization_id)
    )
  );

-- Catalogue de qualifications, et qualifications des agents
alter policy qualification_read on public.qualifications
  using (organization_id in (select private.my_organizations()));
alter policy qualification_write on public.qualifications
  using (organization_id in (select private.managed_organizations()))
  with check (organization_id in (select private.managed_organizations()));
alter policy user_qualification_read on public.user_qualifications
  using (organization_id in (select private.my_organizations()));
alter policy user_qualification_write on public.user_qualifications
  using (organization_id in (select private.managed_organizations()))
  with check (organization_id in (select private.managed_organizations()));

-- Plannings, créneaux, affectations
alter policy schedule_read on public.schedules
  using (organization_id in (select private.my_organizations()));
alter policy schedule_insert on public.schedules
  with check (organization_id in (select private.managed_organizations()));
alter policy schedule_shift_read on public.schedule_shifts
  using (organization_id in (select private.my_organizations()));
alter policy schedule_shift_insert on public.schedule_shifts
  with check (
    exists (
      select 1 from public.schedules s
       where s.id = schedule_id and s.organization_id in (select private.managed_organizations())
    )
  );
alter policy assignment_read on public.schedule_assignments
  using (
    (
      user_id = (select auth.uid())
      and revision > 0
      and exists (select 1 from public.schedule_shifts s where s.id = schedule_shift_id and s.published_revision = revision)
    )
    or exists (
      select 1 from public.schedule_shifts s
      join public.schedules sc on sc.id = s.schedule_id
      where s.id = schedule_shift_id and sc.organization_id in (select private.managed_organizations())
    )
  );
alter policy assignment_draft_write on public.schedule_assignments
  with check (
    revision = 0
    and exists (
      select 1 from public.schedule_shifts s
      join public.schedules sc on sc.id = s.schedule_id
      where s.id = schedule_shift_id and sc.organization_id in (select private.managed_organizations())
    )
  );
alter policy assignment_draft_delete on public.schedule_assignments
  using (
    revision = 0
    and exists (
      select 1 from public.schedule_shifts s
      join public.schedules sc on sc.id = s.schedule_id
      where s.id = schedule_shift_id and sc.organization_id in (select private.managed_organizations())
    )
  );

-- Types de garde
alter policy shift_type_read on public.shift_types
  using (organization_id in (select private.my_organizations()));

-- Désistements
alter policy withdrawal_read on public.shift_withdrawals
  using (user_id = (select auth.uid()) or organization_id in (select private.managed_organizations()));
alter policy withdrawal_insert on public.shift_withdrawals
  with check (
    user_id = (select auth.uid())
    and state = 'PENDING'
    and decided_at is null
    and organization_id in (select private.my_organizations())
    and private.holds_published_shift(schedule_shift_id, (select auth.uid()))
  );
alter policy withdrawal_decide on public.shift_withdrawals
  using (organization_id in (select private.managed_organizations()) and state = 'PENDING')
  with check (organization_id in (select private.managed_organizations()) and state in ('ACCEPTED', 'REFUSED'));

-- Besoins
alter policy requirement_read on public.staffing_requirements
  using (organization_id in (select private.my_organizations()));
alter policy requirement_write on public.staffing_requirements
  using (
    exists (
      select 1 from public.availability_campaigns c
       where c.id = campaign_id and c.organization_id in (select private.managed_organizations())
    )
  )
  with check (
    exists (
      select 1 from public.availability_campaigns c
       where c.id = campaign_id and c.organization_id in (select private.managed_organizations())
    )
  );
alter policy requirement_qualification_read on public.staffing_requirement_qualifications
  using (organization_id in (select private.my_organizations()));
alter policy requirement_qualification_write on public.staffing_requirement_qualifications
  using (
    exists (
      select 1 from public.staffing_requirements r
      join public.availability_campaigns c on c.id = r.campaign_id
      where r.id = requirement_id and c.organization_id in (select private.managed_organizations())
    )
  )
  with check (
    exists (
      select 1 from public.staffing_requirements r
      join public.availability_campaigns c on c.id = r.campaign_id
      where r.id = requirement_id and c.organization_id in (select private.managed_organizations())
    )
  );

-- Équipes
alter policy team_read on public.teams
  using (organization_id in (select private.my_organizations()));
alter policy team_write on public.teams
  using (organization_id in (select private.managed_organizations()))
  with check (organization_id in (select private.managed_organizations()));

commit;
