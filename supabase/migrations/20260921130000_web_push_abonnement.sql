begin;

-- L'appareil s'abonne lui-même : c'est le navigateur qui crée l'abonnement
-- auprès de son service de remise, puis l'application l'attache au compte
-- connecté. Le centre n'est pas demandé au navigateur mais lu ici, sur le
-- rattachement actif : un appareil ne peut pas s'inscrire pour un autre centre
-- que celui de son porteur.
--
-- Le même téléphone peut changer de main — une tablette de garde, un poste
-- partagé. Le navigateur rend alors la même adresse de remise pour le nouveau
-- compte, et la contrainte d'unicité refuserait l'inscription. L'abonnement
-- précédent est donc effacé : posséder l'adresse de remise prouve la main sur
-- l'appareil, et la conserver enverrait les gardes de l'un sur l'écran
-- verrouillé de l'autre. Cette adresse est un secret de 100 caractères tiré par
-- le service de remise : elle ne se devine pas.
create function public.register_push_subscription(device_endpoint text, device_p256dh text, device_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); org uuid;
begin
  if caller is null then raise exception 'Aucune session ouverte.'; end if;
  select m.organization_id into org from public.memberships m
    where m.user_id = caller and m.active limit 1;
  if org is null then raise exception 'Compte rattaché à aucun centre actif.'; end if;
  delete from public.push_subscriptions where endpoint = device_endpoint;
  insert into public.push_subscriptions(organization_id, user_id, endpoint, p256dh, auth)
    values (org, caller, device_endpoint, device_p256dh, device_auth);
end;
$$;
revoke all on function public.register_push_subscription(text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text) to authenticated;

commit;
