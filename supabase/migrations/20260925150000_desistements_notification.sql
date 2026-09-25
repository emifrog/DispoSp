-- C1 et C2 de l'analyse du 25 septembre 2026 : la garde qui évite de
-- renotifier l'encadrement à chaque aller-retour de désistement se trompait
-- dans les deux sens.
--
-- 1. Elle se fiait à une date écrite par l'agent. Le droit d'insertion portait
--    sur toute la table : une demande pouvait arriver avec
--    created_at = '2000-01-01', que la garde ne voyait pas. Demander, retirer,
--    recommencer — dix tours donnaient dix notifications à chaque gestionnaire
--    et dix bulles sur son téléphone. Reproduit. Une session n'insère plus que
--    les quatre colonnes que l'application envoie ; la date est celle de la base.
--
-- 2. Elle ne regardait pas l'état de la demande précédente. Un agent dont la
--    demande avait été refusée, et qui redemandait dans les douze heures avec
--    un motif nouveau, n'était annoncé à personne : ni notification, ni email,
--    ni bulle. Reproduit. Seule une demande que l'agent a lui-même retirée
--    dispense désormais de prévenir — c'est le cas que la garde visait.
--
-- S'applique par-dessus 20260925090000. À coller en entier.
begin;

do $$
begin
  if to_regproc('private.join_open_campaigns') is null then
    raise exception 'Appliquez d''abord 20260925090000_participants_en_cours.sql';
  end if;
  if not has_column_privilege('authenticated', 'public.shift_withdrawals', 'created_at', 'INSERT') then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. La date d'une demande est celle de la base.
-- ---------------------------------------------------------------------------
--
-- Les policies de 20260919200000 disent déjà qui insère et quoi — pour soi,
-- sur une garde qu'on tient, en attente, sans décision. Il manquait de dire
-- quelles colonnes : l'état, la décision et les dates prennent leur valeur par
-- défaut, et seulement elle.
revoke insert on public.shift_withdrawals from authenticated;
grant insert (organization_id, schedule_shift_id, user_id, reason) on public.shift_withdrawals to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ne pas renotifier ce que l'agent a lui-même retiré, et seulement cela.
-- ---------------------------------------------------------------------------
--
-- Le corps est repris de 20260923200000 ; seule la garde de l'insertion change.
create or replace function private.notify_withdrawal() returns trigger
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
    -- La même garde, demandée de nouveau dans les douze heures après que
    -- l'agent a retiré sa demande : l'encadrement a déjà été prévenu, et la
    -- demande figure dans l'écran Demandes. Sans cette garde, désister puis
    -- retirer en boucle écrivait à tout l'encadrement à chaque tour. Une
    -- demande refusée ou acceptée, elle, a été tranchée : en refaire une est
    -- une nouvelle affaire, qu'il faut annoncer.
    if exists (
      select 1 from public.shift_withdrawals w
       where w.user_id = new.user_id and w.schedule_shift_id = new.schedule_shift_id
         and w.id <> new.id and w.state = 'CANCELLED'
         and w.created_at > now() - interval '12 hours'
    ) then
      return null;
    end if;
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

commit;
