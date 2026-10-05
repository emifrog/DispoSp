-- Deux constats de l'analyse du 5 octobre 2026 (docs/ANALYSE_PROJET_2026-10-05.md),
-- tous deux reproduits sur une base neuve avant d'être corrigés.
--
-- B2. Un gestionnaire pouvait réactiver un administrateur désactivé.
--     check_membership_change() ne gardait un administrateur que s'il était
--     actif : le désactiver ou le rétrograder était un geste d'administrateur,
--     le faire revenir n'était gardé par rien. Un gestionnaire, qui ne peut ni
--     inviter, ni nommer, ni désactiver un administrateur, pouvait donc en
--     rendre un à ses droits — lequel nommait ensuite qui il voulait.
--
-- C4. Un agent rattaché pendant un verrouillage n'était jamais inscrit à la
--     campagne déverrouillée. L'inscription des arrivées tardives
--     (20260925090000) écarte les campagnes verrouillées — on ne peut rien y
--     écrire — et ne se déclenche que sur le rattachement. Déverrouiller, ce
--     que l'écran propose tant que la clôture n'est pas passée, ne rattrapait
--     personne : l'agent ne recevait pas l'avis d'ouverture, et sa saisie
--     était refusée.
--
-- S'applique par-dessus 20260927090000. À coller en entier. Aucun code de
-- l'application n'en dépend : l'écran traduit simplement le nouveau refus.
begin;

do $$
begin
  if to_regproc('private.active_elsewhere') is null then
    raise exception 'Appliquez d''abord 20260927090000_correctifs_bilan.sql';
  end if;
  if to_regproc('private.join_unlocked_campaign') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- B2. Seul un administrateur fait d'un compte un administrateur actif.
-- ---------------------------------------------------------------------------
--
-- Le corps de 20260922100000, plus une règle : devenir administrateur actif —
-- par nomination comme par réactivation — est un geste d'administrateur. La
-- nomination l'était déjà par la règle du changement de rôle ; la réactivation
-- ne l'était pas. Un gestionnaire garde la main sur la fiche d'un
-- administrateur désactivé tant qu'il ne le réactive pas, et sur la
-- réactivation de tout autre membre.
--
-- Les scripts de l'éditeur SQL n'ont pas de session : ceux qui touchent un
-- rattachement suspendent déjà ce déclencheur (passer-en-gestionnaire.sql). La
-- réinvitation d'un administrateur désactivé passe, elle, par la session de
-- l'administrateur qui l'invite — un gestionnaire ne peut pas inviter un
-- administrateur (20260920090000).
create or replace function private.check_membership_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    if new.user_id = auth.uid() then raise exception 'Cannot change your own role'; end if;
    if not private.is_administrator(new.organization_id) then
      raise exception 'Only an administrator can change a role';
    end if;
  end if;
  if new.active is distinct from old.active and new.user_id = auth.uid() then
    raise exception 'Cannot deactivate your own account';
  end if;
  -- Désactiver ou rétrograder un administrateur est un geste d'administrateur.
  -- Le changement de rôle l'est déjà par la règle ci-dessus ; la désactivation
  -- ne demandait que le droit d'administrer, qu'un gestionnaire possède.
  if old.role = 'ADMIN' and old.active and (not new.active or new.role <> 'ADMIN') then
    if not private.is_administrator(new.organization_id) then
      raise exception 'Only an administrator can deactivate an administrator';
    end if;
    -- Et jamais le dernier : sans administrateur actif, plus personne ne peut
    -- changer un rôle ni en inviter un — le centre est verrouillé.
    if private.active_administrators(new.organization_id) <= 1 then
      raise exception 'Cannot remove the last administrator';
    end if;
  end if;
  -- Le chemin inverse : redevenir administrateur actif.
  if new.role = 'ADMIN' and new.active and not (old.role = 'ADMIN' and old.active) then
    if not private.is_administrator(new.organization_id) then
      raise exception 'Only an administrator can reactivate an administrator';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- C4. Déverrouiller une campagne inscrit ceux qui sont arrivés entre-temps.
-- ---------------------------------------------------------------------------
--
-- La règle reste celle de create_campaign() et de join_open_campaigns() : les
-- membres actifs de l'équipe participent aux campagnes de cette équipe qui
-- attendent encore des réponses. Une campagne verrouillée n'en attend pas ; la
-- déverrouiller avant sa clôture la rouvre, et ceux qui n'y figurent pas encore
-- y entrent. L'avis d'ouverture part tout seul, par le déclencheur de 0005, et
-- seulement pour eux : on ne réécrit pas à ceux qui étaient déjà inscrits.
--
-- « security definer », comme join_open_campaigns() : l'inscription est un
-- effet du déverrouillage, que la session a déjà le droit de faire.
create function private.join_unlocked_campaign() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (old.locked and not new.locked) or new.closes_at <= now() then return null; end if;
  insert into public.campaign_participants (organization_id, campaign_id, user_id)
    select new.organization_id, new.id, m.user_id
      from public.memberships m
     where m.organization_id = new.organization_id and m.team_id = new.team_id and m.active
    on conflict (campaign_id, user_id) do nothing;
  return null;
end;
$$;
revoke all on function private.join_unlocked_campaign() from public, anon, authenticated;

create trigger join_unlocked_campaign
  after update of locked on public.availability_campaigns
  for each row execute function private.join_unlocked_campaign();

-- Le rattrapage : ceux qui sont arrivés pendant un verrouillage déjà levé.
-- Chacun reçoit l'avis d'ouverture qu'il n'avait jamais eu.
do $$
declare
  m record;
  total integer := 0;
begin
  for m in select organization_id, user_id, team_id from public.memberships where active loop
    total := total + private.join_open_campaigns(m.organization_id, m.user_id, m.team_id);
  end loop;
  raise notice '% inscription(s) rattrapée(s) aux campagnes ouvertes.', total;
end
$$;

commit;
