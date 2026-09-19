-- Rattacher un invité dont le compte existe déjà.
--
-- Le déclencheur de 0004 écoute la confirmation d'adresse : il rattache au
-- moment où un compte neuf confirme la sienne. Un agent qui possède déjà un
-- compte confirmé — parce qu'il a été retiré puis réinvité, ou qu'il vient d'un
-- autre centre — ne repasse jamais par cette confirmation. Son invitation
-- restait donc « en attente » indéfiniment, sans que personne puisse rien y
-- faire depuis l'application.
--
-- L'invitation devient donc le second déclencheur : si le compte est là et son
-- adresse confirmée, le rattachement se fait à l'enregistrement de
-- l'invitation. Les deux chemins appellent le même corps, pour qu'il n'existe
-- qu'une façon de rattacher quelqu'un.
--
-- S'applique par-dessus 20260920090000. À coller en entier.
begin;

do $$
begin
  if to_regproc('public.set_staffing_requirement') is null then
    raise exception 'Appliquez d''abord 20260920090000_correctifs_droits_et_besoins.sql';
  end if;
  if to_regproc('private.attach_invited') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- Le corps commun : recopier la fiche, poser le rattachement, solder
-- l'invitation. Definer, comme l'était accept_invitation() : c'est le moteur
-- qui écrit, pas la session — un agent n'a aucun droit sur memberships, et ne
-- doit pas en gagner.
create function private.attach_invited(invitation public.invitations, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name, grade, fonction, matricule, phone)
    values (member, invitation.display_name, invitation.grade, invitation.fonction,
            invitation.matricule, invitation.phone)
    on conflict (user_id) do nothing;
  insert into public.memberships (organization_id, user_id, team_id, role, active)
    values (invitation.organization_id, member, invitation.team_id, invitation.role, true)
    on conflict (organization_id, user_id) do nothing;
  update public.invitations set accepted_at = now(), accepted_by = member where id = invitation.id;
end;
$$;
revoke all on function private.attach_invited(public.invitations, uuid) from public;

-- Chemin 1, inchangé dans son intention : un compte neuf confirme son adresse.
create or replace function private.accept_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations;
begin
  select * into invitation from public.invitations
   where email = lower(btrim(new.email)) and accepted_at is null
   order by created_at limit 1;
  if invitation.id is null then return new; end if;
  perform private.attach_invited(invitation, new.id);
  return new;
end;
$$;

-- Chemin 2 : l'invitation arrive après le compte.
create function private.accept_invitation_now() returns trigger
language plpgsql security definer set search_path = '' as $$
declare existing uuid;
begin
  select u.id into existing from auth.users u
   where lower(btrim(u.email)) = new.email and u.email_confirmed_at is not null
   limit 1;
  if existing is null then return null; end if;
  perform private.attach_invited(new, existing);
  return null;
end;
$$;
revoke all on function private.accept_invitation_now() from public;
create trigger accept_invitation_now after insert on public.invitations
  for each row execute function private.accept_invitation_now();

commit;
