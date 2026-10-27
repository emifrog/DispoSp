-- Appels à remplacement et à renfort : désistés et fermeture (analyse du
-- 27 octobre 2026, C9 et C10 ; audit de déploiement, A06 et A05).
--
-- 1. private.call_candidates() n'écartait que `leaving`, l'agent du désistement
--    passé à open_call(). Un désistement accepté par un autre chemin — depuis
--    l'écran Désistements, l'agent étant ensuite retiré du brouillon ; ou après
--    un premier appel annulé — laissait l'agent candidat : « Chercher du
--    renfort » le sollicitait pour reprendre la garde qu'il venait de quitter,
--    ce que la spécification interdit (§7). Tout désistement accepté sur le
--    créneau écarte désormais, quel qu'en soit le chemin.
-- 2. private.close_call() passait les propositions retenues à DECLINED et
--    prévenait l'agent — « votre proposition n'a pas été retenue » — sans
--    retirer l'affectation de révision 0 que select_proposal() avait posée.
--    L'agent restait au brouillon, contre le message reçu, et bloquait la garde
--    sous un motif de disponibilité que l'encadrement devait démêler seul. Hors
--    résolution — annulation, expiration —, les retenus sortent du brouillon,
--    comme au retrait d'une proposition. La publication qui résout l'appel ne
--    touche à rien.
--
-- Les corps sont ceux de 20261021090000, auxquels s'ajoutent ces seules lignes.
-- Aucun droit ne change, aucune donnée n'est modifiée. S'applique par-dessus
-- 20261027090000. À coller en entier.
begin;

do $$
begin
  if to_regproc('private.lock_members') is null then
    raise exception 'Appliquez d''abord 20261027090000_verrou_repos.sql';
  end if;
  if coalesce(obj_description('private.call_candidates(uuid, uuid, jsonb)'::regprocedure, 'pg_proc'), '')
     like '%20261027170000%' then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Les candidats : tout désistement accepté sur le créneau écarte
-- ---------------------------------------------------------------------------
create or replace function private.call_candidates(shift uuid, leaving uuid, need jsonb)
returns table (user_id uuid, circle text)
language sql stable security definer set search_path = '' as $$
  with s as (
    select sh.id, sh.date, sh.shift_code, sh.organization_id, sc.campaign_id, c.team_id
      from public.schedule_shifts sh
      join public.schedules sc on sc.id = sh.schedule_id
      join public.availability_campaigns c on c.id = sc.campaign_id
     where sh.id = shift
  )
  select m.user_id,
         case when exists (
           select 1 from public.availability_entries e
           join public.campaign_participants cp on cp.campaign_id = e.campaign_id and cp.user_id = e.user_id
           where e.campaign_id = s.campaign_id and e.user_id = m.user_id and e.date = s.date
             and cp.validated_at is not null and e.availability_type in (s.shift_code, 'FULL_24H')
         ) then 'AVAILABLE' else 'WIDENED' end
    from s
    join public.memberships m on m.organization_id = s.organization_id and m.team_id = s.team_id
   where m.active and private.takes_shifts(m.role)
     and m.user_id is distinct from leaving
     and not m.user_id = any(private.kept_team(shift, leaving))
     and not exists (
       select 1 from public.schedule_assignments a
        where a.schedule_shift_id = shift and a.revision = 0 and a.status <> 'CANCELLED' and a.user_id = m.user_id
     )
     -- Un désistement accepté sur cette garde, quel qu'en soit le chemin : on ne
     -- sollicite pas un agent pour reprendre la garde qu'il vient de quitter.
     and not exists (
       select 1 from public.shift_withdrawals w
        where w.schedule_shift_id = shift and w.user_id = m.user_id and w.state = 'ACCEPTED'
     )
     and private.rest_violation(m.user_id, shift, '{}') is null
     and (
       (need ->> 'missing_headcount')::int > 0
       or exists (
         select 1 from jsonb_array_elements(need -> 'missing_qualifications') mq(item)
         join public.user_qualifications uq
           on uq.user_id = m.user_id and uq.qualification_id = (mq.item ->> 'qualification_id')::uuid
       )
     );
$$;
revoke all on function private.call_candidates(uuid, uuid, jsonb) from public, anon, authenticated;
comment on function private.call_candidates(uuid, uuid, jsonb) is
  'Qui peut répondre à un appel ; écarte tout désistement accepté sur le créneau (20261027170000).';

-- ---------------------------------------------------------------------------
-- 2. La fermeture : hors résolution, les retenus sortent du brouillon
-- ---------------------------------------------------------------------------
create or replace function private.close_call(target uuid, outcome text, revision integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.shift_calls;
  selected uuid[];
begin
  select * into c from public.shift_calls where id = target for update;
  if c.state <> 'OPEN' then return; end if;
  -- Les retenus que la publication a confirmés gardent leur preuve.
  if outcome = 'RESOLVED' then
    update public.call_proposals p set state = 'CONFIRMED', confirmed_at = now()
     where p.call_id = c.id and p.state = 'SELECTED'
       and exists (select 1 from public.schedule_assignments a
                    where a.schedule_shift_id = c.schedule_shift_id and a.revision = close_call.revision
                      and a.user_id = p.user_id and a.status <> 'CANCELLED');
  end if;
  -- Les retenus encore au brouillon, avant que leur proposition soit déclinée.
  select coalesce(array_agg(p.user_id), '{}') into selected
    from public.call_proposals p where p.call_id = c.id and p.state = 'SELECTED';
  insert into public.notifications (organization_id, user_id, kind, subject, body, event_key)
    select c.organization_id, p.user_id, 'CALL_CLOSED',
           'Recherche terminée — ' || private.french_day(c.date),
           'La recherche d''un agent pour la garde ' || case when c.shift_code = 'DAY' then 'de jour' else 'de nuit' end
             || ' du ' || private.shift_text(c.schedule_shift_id) || ', est terminée. '
             || 'Votre proposition n''a pas été retenue. Merci de vous être proposé.',
           'call-closed:' || c.id || ':' || p.user_id
      from public.call_proposals p
     where p.call_id = c.id and p.state in ('PENDING', 'SELECTED')
  on conflict (event_key) where event_key is not null do nothing;
  update public.call_proposals set state = 'DECLINED', closed_at = now()
   where call_id = c.id and state in ('PENDING', 'SELECTED');
  -- Hors résolution, leur place au brouillon tombe avec l'appel — la révision 0
  -- que select_proposal() avait posée —, comme au retrait d'une proposition.
  -- Les propositions sont déjà déclinées : release_proposal n'a rien à relâcher.
  if outcome <> 'RESOLVED' and cardinality(selected) > 0 then
    delete from public.schedule_assignments a
     where a.schedule_shift_id = c.schedule_shift_id and a.revision = 0 and a.user_id = any(selected);
  end if;
  update public.shift_calls
     set state = outcome, closed_at = now(), closed_by = auth.uid(),
         resolved_revision = case when outcome = 'RESOLVED' then close_call.revision end
   where id = c.id;
  insert into public.audit_logs (organization_id, actor_id, entity, entity_id, action, old_value, new_value)
    values (c.organization_id, auth.uid(), 'shift_call', c.id::text, outcome, null,
            jsonb_build_object('date', c.date, 'shift_code', c.shift_code, 'revision', close_call.revision));
  -- Les sollicitations encore en file ne partent plus.
  perform private.cancel_obsolete_notifications(now());
end;
$$;
revoke all on function private.close_call(uuid, text, integer) from public, anon, authenticated;
comment on function private.close_call(uuid, text, integer) is
  'Ferme un appel ; hors résolution, retire du brouillon les retenus (20261027170000).';

commit;
