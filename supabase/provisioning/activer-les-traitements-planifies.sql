-- Activer les traitements planifiés (lot A des évolutions opérationnelles).
--
-- Deux tâches Supabase Cron, toutes les cinq minutes :
--
-- 1. « disposp-generation » : en SQL seul, dans la base. Crée les rappels de
--    garde et les relances arrivés à échéance, annule ceux devenus faux.
--    Aucun appel réseau, aucun secret.
-- 2. « disposp-livraison » : appelle la route /api/traitements de
--    l'application, qui envoie les emails et les notifications push en attente.
--    L'adresse et le secret sont rangés chiffrés dans Vault, jamais en clair
--    dans la définition de la tâche.
--
-- Prérequis :
-- - la migration 20261020090000_traitements_planifies.sql appliquée ;
-- - sur l'hébergeur, la variable SCHEDULED_TASKS_SECRET posée (32 caractères
--   au moins, par exemple `openssl rand -hex 32`), et l'application redéployée ;
-- - la même valeur recopiée ci-dessous.
--
-- Les rappels ne partent ensuite que pour les centres qui les ont activés,
-- depuis Paramètres. Pour tout arrêter : desactiver-les-traitements-planifies.sql.
--
-- Adaptez les deux valeurs, puis exécutez le fichier entier dans l'éditeur SQL.
-- Le relancer remplace l'adresse, le secret et les deux tâches.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  app_url constant text := 'https://dispo-sp.vercel.app';
  secret constant text := 'REMPLACEZ-PAR-LA-VALEUR-DE-SCHEDULED_TASKS_SECRET';
  existing uuid;
begin
  if to_regproc('private.generate_due_notifications') is null then
    raise exception 'Appliquez d''abord 20261020090000_traitements_planifies.sql';
  end if;
  if secret like 'REMPLACEZ%' or length(secret) < 32 then
    raise exception 'Recopiez la valeur de SCHEDULED_TASKS_SECRET (32 caractères au moins).';
  end if;
  -- HTTPS, sauf pour une pile locale d'essai.
  if app_url !~ '^https://[^/]+$' and app_url !~ '^http://(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]+)?$' then
    raise exception 'Adresse de l''application invalide : https://exemple.fr, sans chemin ni barre finale.';
  end if;

  select id into existing from vault.secrets where name = 'disposp_app_url';
  if existing is null then
    perform vault.create_secret(app_url, 'disposp_app_url', 'Adresse de DispoSP pour la livraison planifiée');
  else
    perform vault.update_secret(existing, app_url);
  end if;
  select id into existing from vault.secrets where name = 'disposp_traitements_secret';
  if existing is null then
    perform vault.create_secret(secret, 'disposp_traitements_secret', 'Secret de /api/traitements');
  else
    perform vault.update_secret(existing, secret);
  end if;

  -- cron.schedule remplace une tâche de même nom.
  perform cron.schedule('disposp-generation', '*/5 * * * *', 'select private.generate_due_notifications()');
  perform cron.schedule(
    'disposp-livraison',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'disposp_app_url') || '/api/traitements',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'disposp_traitements_secret'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$
  );
  raise notice 'Traitements planifiés activés : génération et livraison toutes les cinq minutes, vers %.', app_url;
end
$$;

commit;
