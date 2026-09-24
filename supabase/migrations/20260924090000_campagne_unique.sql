-- C5 de l'analyse du 23 septembre 2026 : une campagne par mois et par équipe.
--
-- Rien ne l'interdisait. Le formulaire « Nouvelle campagne » reproposait le mois
-- qu'on venait de créer, et un clic ouvrait une seconde campagne de novembre
-- pour la même équipe : deux collectes, deux plannings, les agents invités deux
-- fois. Une équipe par mois, c'est la base qui le tient désormais ; deux équipes
-- du même centre gardent chacune la leur.
--
-- S'applique par-dessus 20260923200000. À coller en entier.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'private' and table_name = 'invitation_sends' and column_name = 'email'
  ) then
    raise exception 'Appliquez d''abord 20260923200000_relances_et_plafonds.sql';
  end if;
  if to_regclass('public.availability_campaigns_team_month_key') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
  -- Un doublon déjà là ferait échouer l'index sur un message obscur : on le
  -- nomme, pour qu'il soit supprimé ou déplacé avant de recommencer.
  if exists (
    select 1 from public.availability_campaigns
     group by organization_id, team_id, starts_on having count(*) > 1
  ) then
    raise exception 'Appliquez cette migration après avoir retiré le doublon : deux campagnes existent déjà pour la même équipe et le même mois';
  end if;
end
$$;

-- Le nom compte : c'est lui que l'application reconnaît dans le refus pour le
-- traduire (src/lib/command-errors.ts).
create unique index availability_campaigns_team_month_key
  on public.availability_campaigns (organization_id, team_id, starts_on);

commit;
