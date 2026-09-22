-- Ce que contient un centre, avant d'y toucher.
--
-- À exécuter dans l'éditeur SQL du tableau de bord Supabase. Ce fichier ne
-- modifie **rien** : il compte, et c'est tout. Il est le préalable de
-- `basculer-vers-un-vrai-centre.sql`, qui efface pour de bon — on regarde ce
-- qu'on s'apprête à perdre avant de le perdre.
--
-- Adaptez le nom, puis exécutez le fichier entier.

with centre as (select id, name from public.organizations where name = 'CIS Test')
select 'organisation' as objet, (select name from centre) as detail, count(*) as nombre from centre
union all select 'sections', null, count(*) from public.teams where organization_id = (select id from centre)
union all select 'comptes rattachés', null, count(*) from public.memberships where organization_id = (select id from centre)
union all select 'campagnes', null, count(*) from public.availability_campaigns where organization_id = (select id from centre)
union all select 'participations', null, count(*) from public.campaign_participants where organization_id = (select id from centre)
union all select 'disponibilités saisies', null, count(*) from public.availability_entries e
  where e.campaign_id in (select id from public.availability_campaigns where organization_id = (select id from centre))
union all select 'disponibilités habituelles', null, count(*) from public.availability_templates where organization_id = (select id from centre)
union all select 'besoins', null, count(*) from public.staffing_requirements where organization_id = (select id from centre)
union all select 'plannings', null, count(*) from public.schedules where organization_id = (select id from centre)
union all select 'créneaux', null, count(*) from public.schedule_shifts where organization_id = (select id from centre)
union all select 'affectations', null, count(*) from public.schedule_assignments where organization_id = (select id from centre)
union all select 'dont publiées', null, count(*) from public.schedule_assignments where organization_id = (select id from centre) and revision > 0
union all select 'désistements', null, count(*) from public.shift_withdrawals where organization_id = (select id from centre)
union all select 'qualifications au catalogue', null, count(*) from public.qualifications where organization_id = (select id from centre)
union all select 'qualifications attribuées', null, count(*) from public.user_qualifications where organization_id = (select id from centre)
union all select 'invitations', null, count(*) from public.invitations where organization_id = (select id from centre)
union all select 'notifications', null, count(*) from public.notifications where organization_id = (select id from centre)
union all select 'appareils abonnés', null, count(*) from public.push_subscriptions where organization_id = (select id from centre)
union all select 'lignes de journal d''audit', null, count(*) from public.audit_logs where organization_id = (select id from centre);

-- Et qui est rattaché, pour décider qui suit dans le nouveau centre. Les comptes
-- d'authentification, eux, ne sont jamais supprimés par ces scripts : un compte
-- laissé sans rattachement peut toujours se connecter, et l'application lui dit
-- qu'il n'appartient à aucun centre.
select u.email, p.display_name, m.role, m.active, t.name as section
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  left join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  left join public.teams t on t.id = m.team_id
 where o.name = 'CIS Test'
 order by m.role, p.display_name;
