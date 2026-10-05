-- C3 de l'analyse du 5 octobre 2026 (docs/ANALYSE_PROJET_2026-10-05.md) :
-- une erreur de configuration Resend faisait échouer définitivement toute la
-- file d'emails. Reproduit (.local/audit-20261005/serveur/envois.test.ts).
--
-- finish_email_delivery() classe un refus 4xx comme propre au message : il ne
-- partira jamais, on n'insiste pas. C'est juste pour une adresse invalide, faux
-- pour un refus qui vise le compte d'envoi — domaine non vérifié (403), clé
-- révoquée (401, 403), quota du jour atteint (429). Ce refus-là vaut pour
-- chaque message : une seule commande soldait jusqu'à deux cents messages en
-- « failed », et rien ne les reprenait une fois le compte corrigé.
--
-- Désormais, le serveur reconnaît ces refus, suspend le passage et rend les
-- messages qu'il avait réservés : ils retournent en file, sans que la
-- tentative compte, pour un nouvel essai après un délai. La première campagne
-- ne perd plus ses emails parce que le domaine n'était pas encore vérifié.
--
-- S'applique par-dessus 20261005090000. À coller en entier, **avant** de
-- déployer le code qui l'accompagne : le serveur appelle
-- release_email_delivery() dès qu'il rencontre un tel refus.
begin;

do $$
begin
  if to_regproc('private.join_unlocked_campaign') is null then
    raise exception 'Appliquez d''abord 20261005090000_reactivation_admin_deverrouillage.sql';
  end if;
  if to_regproc('public.release_email_delivery') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- Rendre un message réservé, sans compter la tentative.
--
-- `http_status` : le refus que Resend vient de faire à ce message, ou rien pour
-- un message du même lot qui n'a pas été tenté. La clé d'idempotence change
-- dans le premier cas — Resend a répondu n'avoir rien envoyé, et l'on ignore
-- s'il garde cette réponse pour la clé ; la garder pourrait la faire rendre
-- encore, compte corrigé — et reste dans le second, où Resend n'a rien reçu.
--
-- Trois jours au plus : au-delà, un avis a perdu son objet — rappel d'une
-- campagne close, publication que l'agent a lue depuis dans l'application — et
-- partir après la réparation du compte ne ferait qu'encombrer sa boîte. Il passe
-- alors en échec ; la notification, elle, reste dans le centre de messages.
create function public.release_email_delivery(
  delivery uuid,
  token uuid,
  retry_in integer,
  http_status integer default null
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.notifications n set
    email_status = case when n.created_at < now() - interval '3 days' then 'failed' else 'pending' end,
    email_attempts = greatest(n.email_attempts - 1, 0),
    email_last_status = coalesce(http_status, n.email_last_status),
    email_lease = null,
    email_available_at = now() + make_interval(secs => greatest(coalesce(retry_in, 0), 60)),
    email_key = case when http_status is null then n.email_key else gen_random_uuid() end
   where n.id = delivery and n.email_lease = token and n.email_status = 'sending';
end;
$$;
revoke all on function public.release_email_delivery(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.release_email_delivery(uuid, uuid, integer, integer) to service_role;

commit;
