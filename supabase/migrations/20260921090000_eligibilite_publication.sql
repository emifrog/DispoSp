-- Ce qu'une publication doit encore vérifier.
--
-- `publish_schedule_shift` contrôlait la disponibilité validée, l'effectif et
-- les qualifications. Deux conditions manquaient, et elles n'ont rien à voir
-- l'une avec l'autre :
--
-- 1. **Le membre désactivé.** Un agent retiré de l'effectif gardait ses
--    anciennes disponibilités validées, donc restait publiable. La faille vaut
--    sans aucun désistement, et par appel direct à l'API autant que par
--    l'écran.
--
-- 2. **Le désistement accepté.** L'encadrement répondait « vous n'êtes plus
--    attendu », puis republiait le même agent : la notification et le planning
--    se contredisaient.
--
-- S'applique par-dessus 20260920140000. À coller en entier.
begin;

do $$
begin
  if to_regproc('private.attach_invited') is null then
    raise exception 'Appliquez d''abord 20260920140000_invitation_compte_existant.sql';
  end if;
  if to_regproc('private.withdrew_from') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

/*
 * Un désistement écarte-t-il encore cet agent de cette garde ?
 *
 * Accepté, oui — mais pas pour toujours. Le garde vise l'oubli : accepter un
 * désistement puis republier sans avoir remplacé. Si l'encadrement réaffecte
 * l'agent **après** avoir tranché, c'est une décision neuve, et elle prime :
 * la réaffectation porte sa propre date, et il suffit de comparer les deux.
 *
 * Sans cette comparaison, un désistement d'octobre interdirait cette garde à
 * cet agent pour toujours, sans aucun moyen de revenir dessus.
 */
create function private.withdrew_from(shift uuid, member uuid, assigned timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shift_withdrawals w
     where w.schedule_shift_id = shift and w.user_id = member
       and w.state = 'ACCEPTED' and w.decided_at > assigned
  );
$$;
revoke all on function private.withdrew_from(uuid, uuid, timestamptz) from public;
grant execute on function private.withdrew_from(uuid, uuid, timestamptz) to authenticated;

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
  select * into s from public.schedule_shifts where id = shift;
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
