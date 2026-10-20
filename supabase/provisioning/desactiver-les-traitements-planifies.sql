-- Désactiver les traitements planifiés (lot A).
--
-- Retire les deux tâches Supabase Cron. Rien d'autre ne change : les
-- notifications, la file d'envoi, le journal des passages et le réglage des
-- centres restent tels quels. Les messages en attente partiront après la
-- prochaine action d'un utilisateur, comme avant le lot A, ou à la réactivation.
--
-- L'adresse et le secret restent dans Vault ; les en retirer est sans risque,
-- mais il faudra les recopier à la réactivation.
begin;

do $$
declare
  removed integer;
begin
  if to_regclass('cron.job') is null then
    raise notice 'Supabase Cron n''est pas activé : aucune tâche à retirer.';
    return;
  end if;
  select count(*) into removed from cron.job where jobname in ('disposp-generation', 'disposp-livraison');
  perform cron.unschedule(jobid) from cron.job where jobname in ('disposp-generation', 'disposp-livraison');
  raise notice '% tâche(s) planifiée(s) retirée(s).', removed;
end
$$;

commit;
