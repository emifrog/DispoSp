-- B1 de l'analyse du 25 septembre 2026 : un agent arrivé après l'ouverture
-- d'une campagne ne pouvait jamais y répondre.
--
-- Seules deux instructions inscrivaient des participants : create_campaign(), à
-- l'ouverture, et le script premiere-campagne.sql. Aucun déclencheur ne le
-- faisait au rattachement, aucun écran ne le proposait. Or l'ordre recommandé
-- pour le pilote ouvre la première campagne puis invite les agents : chacun
-- d'eux tombait sur « Aucune campagne ne vous concerne », et l'encadrement
-- n'avait aucun moyen de l'ajouter hors de l'éditeur SQL. Reproduit.
--
-- Désormais, un membre qui devient actif dans une équipe — rattachement par
-- invitation, réactivation, changement d'équipe — est inscrit aux campagnes de
-- cette équipe qui attendent encore des réponses. C'est la règle même de
-- create_campaign() — « les membres actifs de l'équipe » —, appliquée à qui
-- arrive après. L'avis d'ouverture part tout seul : le déclencheur de 0005
-- l'écrit à chaque inscription, et les files d'email et de notifications
-- poussées le reprennent.
--
-- Rien n'est retiré : un membre désactivé, ou passé dans une autre équipe,
-- garde sa participation et ses réponses. Les écrans comptent déjà les seuls
-- membres actifs.
--
-- S'applique par-dessus 20260924090000. À coller en entier.
begin;

do $$
begin
  if to_regclass('public.availability_campaigns_team_month_key') is null then
    raise exception 'Appliquez d''abord 20260924090000_campagne_unique.sql';
  end if;
  if to_regproc('private.join_open_campaigns') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- Une campagne attend encore des réponses tant qu'elle n'est ni verrouillée ni
-- close : c'est la fenêtre même que check_availability_write() fait respecter.
-- Une inscription hors de cette fenêtre ne servirait à rien — l'agent ne
-- pourrait rien y écrire — et ferait partir un avis d'ouverture mensonger.
--
-- « security definer » : l'inscription est un effet du rattachement, pas un
-- geste de la session. Le rattachement lui-même passe déjà par ses propres
-- contrôles — invitation, save_member(), déclencheur membership_change.
create function private.join_open_campaigns(org uuid, member uuid, team uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare joined integer;
begin
  insert into public.campaign_participants (organization_id, campaign_id, user_id)
    select c.organization_id, c.id, member
      from public.availability_campaigns c
     where c.organization_id = org and c.team_id = team
       and not c.locked and c.closes_at > now()
    on conflict (campaign_id, user_id) do nothing;
  get diagnostics joined = row_count;
  return joined;
end;
$$;
revoke all on function private.join_open_campaigns(uuid, uuid, uuid) from public, anon, authenticated;

create function private.join_campaigns_on_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.active then return null; end if;
  if TG_OP = 'UPDATE' and old.active and old.team_id is not distinct from new.team_id then return null; end if;
  perform private.join_open_campaigns(new.organization_id, new.user_id, new.team_id);
  return null;
end;
$$;
revoke all on function private.join_campaigns_on_membership() from public, anon, authenticated;

create trigger join_campaigns_on_membership
  after insert or update of active, team_id on public.memberships
  for each row execute function private.join_campaigns_on_membership();

-- Le rattrapage : ceux qui sont déjà arrivés trop tard. Chacun reçoit l'avis
-- d'ouverture qu'il n'avait jamais eu.
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
