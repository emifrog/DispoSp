-- Point 4 de l'audit de déployabilité du 22 septembre 2026.
--
-- La fiche d'un agent s'écrivait en quatre allers-retours : le rattachement,
-- le profil, l'effacement des qualifications retirées, l'ajout des nouvelles.
-- Un refus au troisième laissait l'équipe et le rôle changés, le nom changé,
-- et les qualifications d'avant — alors que l'écran annonçait un échec.
-- `save_member()` fait les quatre d'un bloc : tout tient, ou rien.
--
-- S'applique par-dessus 20260922150000. À coller en entier.
begin;

do $$
begin
  if to_regproc('public.claim_email_deliveries') is null then
    raise exception 'Appliquez d''abord 20260922150000_rattachement_retrait_file_email.sql';
  end if;
  if to_regproc('public.save_member') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- « security invoker », comme set_staffing_requirement : aucun droit de plus.
-- Les policies de memberships, profiles et user_qualifications jugent chaque
-- écriture, et le déclencheur de 0004 juge le rôle et la désactivation — sous
-- la session de qui modifie. L'audit s'écrit ligne à ligne, comme avant.
--
-- L'ordre reste celui de l'écriture précédente : le rattachement d'abord, pour
-- qu'une réactivation rende la fiche modifiable avant qu'on la modifie.
create function public.save_member(
  org uuid,
  member uuid,
  team uuid,
  member_role text,
  is_active boolean,
  member_name text,
  member_grade text,
  member_fonction text,
  member_matricule text,
  member_phone text,
  qualification_names text[]
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  wanted text[] := array(select distinct n from unnest(coalesce(qualification_names, '{}')) as n where n <> '');
begin
  -- Une ligne que la policy ne laisse pas voir ne se modifie pas, sans erreur :
  -- zéro ligne touchée est un refus, et il se dit.
  update public.memberships set team_id = team, role = member_role, active = is_active
   where organization_id = org and user_id = member;
  if not found then raise exception 'Not allowed to edit this member'; end if;

  update public.profiles set display_name = member_name, grade = member_grade, fonction = member_fonction,
         matricule = member_matricule, phone = member_phone
   where user_id = member;
  if not found then raise exception 'Not allowed to edit this member'; end if;

  -- L'écran envoie toujours l'ensemble complet : ce qui n'y figure plus s'en va.
  delete from public.user_qualifications uq
   using public.qualifications q
   where uq.organization_id = org and uq.user_id = member
     and q.organization_id = org and q.id = uq.qualification_id
     and not (q.name = any(wanted));

  -- Le catalogue se complète comme il le faisait : créer une qualification
  -- demande d'être administrateur, et le refus annule toute la fiche.
  insert into public.qualifications (organization_id, name)
    select org, n from unnest(wanted) as n
     where not exists (select 1 from public.qualifications q where q.organization_id = org and q.name = n);

  insert into public.user_qualifications (organization_id, user_id, qualification_id)
    select org, member, q.id from public.qualifications q
     where q.organization_id = org and q.name = any(wanted)
       and not exists (
         select 1 from public.user_qualifications uq where uq.user_id = member and uq.qualification_id = q.id
       );
end;
$$;
revoke all on function public.save_member(uuid, uuid, uuid, text, boolean, text, text, text, text, text, text[])
  from public;
grant execute on function public.save_member(uuid, uuid, uuid, text, boolean, text, text, text, text, text, text[])
  to authenticated;

commit;
