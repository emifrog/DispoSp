-- Deux correctifs issus de l'audit du 19 septembre 2026.
--
-- 1. Un gestionnaire pouvait faire entrer un administrateur par invitation,
--    alors que la base lui refuse de promouvoir qui que ce soit. Reproduit :
--    la voie directe rendait « Only an administrator can change a role », la
--    voie de l'invitation aboutissait à un membre ADMIN.
--
-- 2. L'écriture d'un besoin se faisait en trois requêtes séparées — effectif,
--    effacement des minima, insertion des nouveaux. Un refus sur la dernière
--    laissait le créneau sans aucune exigence de qualification, alors que
--    l'appelant recevait une erreur.
--
-- S'applique par-dessus 20260919200000. À coller en entier.
begin;

do $$
begin
  if to_regclass('public.shift_withdrawals') is null then
    raise exception 'Appliquez d''abord 20260919200000_desistements.sql';
  end if;
  if to_regproc('public.set_staffing_requirement') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. On ne donne pas plus que ce qu'on a.
-- ---------------------------------------------------------------------------

-- La policy vérifiait le droit d'administrer le centre — qu'un gestionnaire
-- possède — sans jamais regarder le rôle accordé. Elle regarde maintenant les
-- deux : accorder ADMIN demande d'être ADMIN soi-même.
--
-- La règle porte sur l'insertion ET sur la modification, puisque le rôle d'une
-- invitation en attente reste modifiable : la contourner en deux temps, en
-- invitant un agent puis en relevant son rôle, ne doit pas marcher non plus.
drop policy invitation_write on public.invitations;
create policy invitation_write on public.invitations for all to authenticated
  using (private.can_administer(organization_id) and accepted_at is null)
  with check (
    private.can_administer(organization_id)
    and accepted_at is null
    and (role <> 'ADMIN' or private.is_administrator(organization_id))
  );

-- ---------------------------------------------------------------------------
-- 2. Un besoin s'écrit en entier ou pas du tout.
-- ---------------------------------------------------------------------------

-- « security invoker » : la fonction ne donne aucun droit supplémentaire, elle
-- ne fait que réunir en une transaction ce qui se faisait en trois allers-
-- retours. Les policies et les déclencheurs s'appliquent comme avant —
-- notamment requirement_minimum, qui exige que l'effectif soit écrit avant les
-- minima pour juger la paire complète.
create function public.set_staffing_requirement(
  campaign uuid,
  on_date date,
  shift text,
  total integer,
  minima jsonb
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  org uuid;
  req uuid;
begin
  select c.organization_id into org from public.availability_campaigns c where c.id = campaign;
  if org is null then raise exception 'Unknown campaign'; end if;

  insert into public.staffing_requirements (organization_id, campaign_id, date, shift_code, headcount)
    values (org, campaign, on_date, shift, total)
    on conflict (campaign_id, date, shift_code) do update set headcount = excluded.headcount
    returning id into req;

  -- Le catalogue se complète à mesure que les besoins se définissent, comme le
  -- faisait l'écriture précédente. Qui n'a pas le droit d'y ajouter une ligne
  -- se le verra refuser ici, et toute l'écriture sera annulée avec.
  insert into public.qualifications (organization_id, name)
    select org, m.key
      from jsonb_each_text(minima) as m(key, value)
     where m.value::int > 0
       and not exists (
         select 1 from public.qualifications q where q.organization_id = org and q.name = m.key
       );

  delete from public.staffing_requirement_qualifications where requirement_id = req;

  insert into public.staffing_requirement_qualifications (organization_id, requirement_id, qualification_id, minimum)
    select org, req, q.id, m.value::int
      from jsonb_each_text(minima) as m(key, value)
      join public.qualifications q on q.organization_id = org and q.name = m.key
     where m.value::int > 0;
end;
$$;
revoke all on function public.set_staffing_requirement(uuid, date, text, integer, jsonb) from public;
grant execute on function public.set_staffing_requirement(uuid, date, text, integer, jsonb) to authenticated;

commit;
