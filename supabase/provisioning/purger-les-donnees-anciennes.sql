-- Purge des données arrivées au terme de leur durée de conservation.
--
-- À exécuter dans l'éditeur SQL du tableau de bord Supabase, avec les droits du
-- propriétaire, à la fréquence fixée dans docs/RGPD.md (une fois par mois
-- suffit). Les durées ci-dessous sont des PROPOSITIONS : elles se valident avec
-- le délégué à la protection des données du SDIS avant la première exécution,
-- puis se reportent ici et dans le registre de traitement.
--
-- Ce qui part, et seulement cela :
--   — les lignes du journal d'audit plus anciennes que la durée du journal ;
--   — les notifications plus anciennes que la leur (et leurs envois poussés) ;
--   — les invitations, acceptées ou non, plus anciennes que la leur : elles
--     recopient nom, adresse, téléphone et matricule d'une personne, et ne
--     servent plus une fois le compte créé ou l'invitation oubliée ;
--   — les campagnes terminées depuis plus longtemps que la durée des campagnes,
--     avec tout ce qui en dépend : disponibilités, réponses, besoins, planning,
--     affectations, désistements.
--
-- Rien ne touche aux comptes, aux fiches ni aux rattachements : le départ d'un
-- agent passe par retirer-un-compte.sql.
--
-- Les déclencheurs des tables purgées sont suspendus le temps de la purge. Sans
-- cela, chaque suppression écrirait au journal une ligne recopiant ce qu'elle
-- efface — la purge réintroduirait les données qu'elle retire —, et le
-- déclencheur de saisie refuserait d'effacer une campagne close. Les clés
-- étrangères, elles, restent actives : l'ordre des suppressions les respecte.
--
-- Pas de begin/commit : un bloc `do` est atomique. Un échec annule tout, la
-- suspension des déclencheurs comprise.

do $$
declare
  -- ------------------------------------------------------------------------
  -- Durées de conservation — à valider avec le DPO.
  -- ------------------------------------------------------------------------
  duree_journal constant interval := '12 months';
  duree_notifications constant interval := '6 months';
  duree_invitations constant interval := '3 months';
  duree_campagnes constant interval := '24 months';

  anciennes uuid[];
  n int;
begin
  alter table public.audit_logs disable trigger user;
  alter table public.notifications disable trigger user;
  alter table public.invitations disable trigger user;
  alter table public.availability_entries disable trigger user;
  alter table public.campaign_participants disable trigger user;
  alter table public.staffing_requirements disable trigger user;
  alter table public.staffing_requirement_qualifications disable trigger user;
  alter table public.schedule_assignments disable trigger user;
  alter table public.shift_withdrawals disable trigger user;
  alter table public.availability_campaigns disable trigger user;

  -- Les campagnes d'abord : leur effacement ne doit rien ajouter au journal
  -- qu'on purge ensuite.
  select coalesce(array_agg(id), '{}') into anciennes
    from public.availability_campaigns
   where ends_on < current_date - duree_campagnes;

  delete from public.shift_withdrawals w using public.schedule_shifts s, public.schedules p
   where w.schedule_shift_id = s.id and s.schedule_id = p.id and p.campaign_id = any(anciennes);
  delete from public.schedule_assignments a using public.schedule_shifts s, public.schedules p
   where a.schedule_shift_id = s.id and s.schedule_id = p.id and p.campaign_id = any(anciennes);
  delete from public.schedule_shifts s using public.schedules p
   where s.schedule_id = p.id and p.campaign_id = any(anciennes);
  delete from public.schedules where campaign_id = any(anciennes);
  -- Les minima partent en cascade avec leur besoin.
  delete from public.staffing_requirements where campaign_id = any(anciennes);
  delete from public.availability_entries where campaign_id = any(anciennes);
  delete from public.campaign_participants where campaign_id = any(anciennes);
  delete from public.availability_campaigns where id = any(anciennes);
  raise notice 'Campagnes terminées avant le % : % effacée(s).', current_date - duree_campagnes, cardinality(anciennes);

  delete from public.invitations where created_at < now() - duree_invitations;
  get diagnostics n = row_count;
  raise notice 'Invitations de plus de % : % effacée(s).', duree_invitations, n;

  delete from public.notifications where created_at < now() - duree_notifications;
  get diagnostics n = row_count;
  raise notice 'Notifications de plus de % : % effacée(s).', duree_notifications, n;

  delete from public.audit_logs where occurred_at < now() - duree_journal;
  get diagnostics n = row_count;
  raise notice 'Lignes de journal de plus de % : % effacée(s).', duree_journal, n;

  alter table public.audit_logs enable trigger user;
  alter table public.notifications enable trigger user;
  alter table public.invitations enable trigger user;
  alter table public.availability_entries enable trigger user;
  alter table public.campaign_participants enable trigger user;
  alter table public.staffing_requirements enable trigger user;
  alter table public.staffing_requirement_qualifications enable trigger user;
  alter table public.schedule_assignments enable trigger user;
  alter table public.shift_withdrawals enable trigger user;
  alter table public.availability_campaigns enable trigger user;
end
$$;
