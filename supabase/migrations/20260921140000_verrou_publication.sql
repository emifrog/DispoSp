begin;

-- Publier deux fois le même créneau, au même instant.
--
-- La fonction lisait le créneau sans le verrouiller, puis calculait la
-- révision suivante à partir de ce qu'elle avait lu. Deux responsables qui
-- publient ensemble lisaient donc la même révision et en calculaient la même :
-- la clé primaire de public.schedule_assignments — (créneau, agent, révision) —
-- arrêtait bien la seconde, mais par une violation de contrainte, c'est-à-dire
-- par un message que personne ne peut présenter à un utilisateur.
--
-- « for update » fait attendre la seconde transaction jusqu'à la fin de la
-- première. Elle relit alors la révision publiée, calcule la suivante et
-- republie par-dessus — ou bute sur un contrôle d'éligibilité, ce qui est un
-- refus explicite. Le verrou ne porte que sur la ligne du créneau : deux
-- publications sur deux créneaux différents ne s'attendent pas.
--
-- Le corps est repris à l'identique de 20260921090000 ; seul le verrou change.

create or replace function private.publish_schedule_shift(shift uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.schedule_shifts;
  sch public.schedules;
  req public.staffing_requirements;
  campaign uuid;
  retained integer;
  missing text;
  refused text;
  next_revision integer;
begin
  select * into s from public.schedule_shifts where id = shift for update;
  if s.id is null then raise exception 'Unknown shift'; end if;
  select * into sch from public.schedules where id = s.schedule_id;
  if not private.can_manage(sch.organization_id, sch.team_id) then
    raise exception 'Not allowed to publish this schedule';
  end if;
  campaign := sch.campaign_id;

  select count(*) into retained from public.schedule_assignments a
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED';

  -- Never derive an assignment from an availability: check they still agree.
  if exists (
    select 1 from public.schedule_assignments a
     where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
       and not exists (
         select 1 from public.availability_entries e
         join public.campaign_participants p on p.campaign_id = e.campaign_id and p.user_id = e.user_id
         where e.campaign_id = campaign and e.user_id = a.user_id and e.date = s.date
           and p.validated_at is not null
           and e.availability_type in (s.shift_code, 'FULL_24H')
       )
  ) then
    raise exception 'Every assignment needs a validated matching availability';
  end if;

  -- Un agent sorti de l'effectif n'est plus affectable, quelles que soient les
  -- disponibilités qu'il avait validées avant son départ.
  select string_agg(coalesce(p.display_name, a.user_id::text), ', ') into refused
    from public.schedule_assignments a
    left join public.profiles p on p.user_id = a.user_id
    left join public.memberships m
      on m.organization_id = sch.organization_id and m.user_id = a.user_id
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     and coalesce(m.active, false) = false;
  if refused is not null then raise exception 'Inactive members cannot be published: %', refused; end if;

  -- Un désistement accepté depuis l'affectation : remplacer, ou réaffecter
  -- explicitement. Publier tel quel contredirait la réponse faite à l'agent.
  select string_agg(coalesce(p.display_name, a.user_id::text), ', ') into refused
    from public.schedule_assignments a
    left join public.profiles p on p.user_id = a.user_id
   where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     and private.withdrew_from(shift, a.user_id, a.assigned_at);
  if refused is not null then raise exception 'Accepted withdrawal still assigned: %', refused; end if;

  select * into req from public.staffing_requirements
   where campaign_id = campaign and date = s.date and shift_code = s.shift_code;
  if req.id is null then raise exception 'Define the staffing requirement before publishing'; end if;
  if retained < req.headcount then
    raise exception 'Headcount not covered: % of %', retained, req.headcount;
  end if;

  select string_agg(q.name, ', ') into missing
    from public.staffing_requirement_qualifications rq
    join public.qualifications q on q.id = rq.qualification_id
   where rq.requirement_id = req.id
     and rq.minimum > (
       select count(*) from public.schedule_assignments a
       join public.user_qualifications uq on uq.user_id = a.user_id and uq.qualification_id = rq.qualification_id
       where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED'
     );
  if missing is not null then raise exception 'Qualifications not covered: %', missing; end if;

  next_revision := s.published_revision + 1;
  insert into public.schedule_assignments (organization_id, schedule_shift_id, user_id, revision, status, assigned_by, assigned_at)
    select a.organization_id, a.schedule_shift_id, a.user_id, next_revision, 'CONFIRMED', a.assigned_by, now()
      from public.schedule_assignments a
     where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED';
  update public.schedule_shifts set published_revision = next_revision, published_at = now() where id = shift;

  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (sch.organization_id, auth.uid(), 'schedule_shift', shift::text, 'PUBLISH',
            jsonb_build_object('revision', s.published_revision),
            jsonb_build_object('revision', next_revision, 'headcount', retained));

  insert into public.notifications (organization_id, user_id, kind, subject)
    select sch.organization_id, a.user_id, 'SCHEDULE_PUBLISHED', 'Votre planning a été publié'
      from public.schedule_assignments a
     where a.schedule_shift_id = shift and a.revision = next_revision;

  return next_revision;
end;
$$;

commit;
