-- B1 de l'analyse du 23 septembre 2026 : un envoi d'invitation qui échoue ne
-- doit pas compter.
--
-- `reserve_invitation_send` inscrit l'envoi avant que le serveur appelle
-- Supabase Auth, et rien ne le retirait quand l'appel échouait. Or le relais
-- intégré de Supabase n'envoie que quelques messages par heure : à l'arrivée
-- d'un centre, l'essentiel des invitations échoue, et chaque échec imposait un
-- quart d'heure d'attente annoncé comme « le message est parti », puis
-- condamnait l'invitation au cinquième.
--
-- `release_invitation_send` retire la dernière réservation d'une invitation.
-- Elle n'est accordée qu'au serveur (`service_role`) : ouverte à une session,
-- elle remettrait les limites à zéro à volonté, puisque réserver n'envoie rien
-- et que seul le serveur envoie.
--
-- S'applique par-dessus 20260923140000. À coller en entier.
begin;

do $$
begin
  if to_regproc('public.reserve_invitation_send') is null then
    raise exception 'Appliquez d''abord 20260923140000_limites_envois.sql';
  end if;
  if to_regproc('public.release_invitation_send') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- La dernière, et elle seule : le quart d'heure entre deux envois garantit qu'il
-- n'y en a qu'une de récente par invitation. Une invitation effacée entre-temps
-- a emporté son journal avec elle ; il n'y a alors rien à rendre.
create function public.release_invitation_send(invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.invitation_sends s
   where s.invitation_id = invitation
     and s.sent_at = (select max(t.sent_at) from private.invitation_sends t where t.invitation_id = invitation);
end;
$$;
revoke all on function public.release_invitation_send(uuid) from public, anon, authenticated;
grant execute on function public.release_invitation_send(uuid) to service_role;

commit;
