-- Export de toutes les données d'un compte (RGPD, art. 15 et 20).
--
-- À exécuter dans l'éditeur SQL du tableau de bord Supabase. Rend une seule
-- valeur JSON : copiez-la dans un fichier et remettez-le à la personne, par
-- un canal qui convient à des données personnelles. Rien n'est modifié.
--
-- Adaptez l'adresse, puis exécutez le fichier entier. Voir docs/RGPD.md.

with compte as (
  select id, email, created_at, last_sign_in_at from auth.users where email = 'agent@exemple.fr'
)
select jsonb_pretty(jsonb_build_object(
  'exporte_le', now(),
  'compte', (select to_jsonb(c) from compte c),
  'fiche', (select to_jsonb(p) from public.profiles p where p.user_id = (select id from compte)),
  'rattachements', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'centre', o.name, 'equipe', t.name, 'role', m.role, 'actif', m.active)), '[]')
      from public.memberships m
      join public.organizations o on o.id = m.organization_id
      left join public.teams t on t.id = m.team_id
     where m.user_id = (select id from compte)),
  'qualifications', (
    select coalesce(jsonb_agg(jsonb_build_object('qualification', q.name, 'obtenue_le', uq.obtained_on)), '[]')
      from public.user_qualifications uq join public.qualifications q on q.id = uq.qualification_id
     where uq.user_id = (select id from compte)),
  'disponibilite_habituelle', (
    select coalesce(jsonb_agg(to_jsonb(a) - 'user_id' - 'organization_id' order by a.weekday), '[]')
      from public.availability_templates a where a.user_id = (select id from compte)),
  'campagnes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'campagne', c.name, 'du', c.starts_on, 'au', c.ends_on, 'reponse_validee_le', p.validated_at,
      'disponibilites', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'date', e.date, 'disponibilite', e.availability_type, 'commentaire', e.comment) order by e.date), '[]')
          from public.availability_entries e where e.campaign_id = c.id and e.user_id = p.user_id)
    ) order by c.starts_on), '[]')
      from public.campaign_participants p join public.availability_campaigns c on c.id = p.campaign_id
     where p.user_id = (select id from compte)),
  'gardes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', s.date, 'creneau', s.shift_code, 'revision', a.revision, 'statut', a.status) order by s.date, s.shift_code), '[]')
      from public.schedule_assignments a join public.schedule_shifts s on s.id = a.schedule_shift_id
     where a.user_id = (select id from compte)),
  'desistements', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', s.date, 'creneau', s.shift_code, 'motif', w.reason, 'etat', w.state,
      'demande_le', w.created_at, 'tranche_le', w.decided_at) order by w.created_at), '[]')
      from public.shift_withdrawals w join public.schedule_shifts s on s.id = w.schedule_shift_id
     where w.user_id = (select id from compte)),
  'notifications', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sujet', n.subject, 'texte', n.body, 'creee_le', n.created_at, 'lue_le', n.read_at) order by n.created_at), '[]')
      from public.notifications n where n.user_id = (select id from compte)),
  'appareils_abonnes', (
    select coalesce(jsonb_agg(jsonb_build_object('abonne_le', s.created_at)), '[]')
      from public.push_subscriptions s where s.user_id = (select id from compte)),
  'invitations', (
    select coalesce(jsonb_agg(to_jsonb(i) - 'organization_id' - 'team_id' - 'invited_by' - 'accepted_by'), '[]')
      from public.invitations i where i.email = (select lower(email) from compte)),
  'envois_d_invitation', (
    select coalesce(jsonb_agg(s.sent_at order by s.sent_at), '[]')
      from private.invitation_sends s where s.email = (select lower(email) from compte)),
  -- L'agenda abonné du lot D : les dates de ses abonnements, jamais l'adresse —
  -- la base n'en garde que le condensat.
  'abonnements_agenda', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'cree_le', f.created_at, 'revoque_le', f.revoked_at, 'derniere_lecture', f.last_read_at)
      order by f.created_at), '[]')
      from public.calendar_feeds f where f.user_id = (select id from compte)),
  -- Les appels du lot C : ses propositions, et sa déclaration s'il en a fait une.
  'propositions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', c.date, 'creneau', c.shift_code, 'etat', p.state, 'proposee_le', p.proposed_at,
      'declaration', p.declared, 'horaires_declares',
      case when p.declared then jsonb_build_object('du', p.declared_starts_at, 'au', p.declared_ends_at) end,
      'retiree_le', p.withdrawn_at) order by p.proposed_at), '[]')
      from public.call_proposals p join public.shift_calls c on c.id = p.call_id
     where p.user_id = (select id from compte)),
  -- Les photographies du lot A : ce qu'elles ont retenu de la personne.
  'photographies_publication', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', f.date, 'creneau', f.shift_code, 'version', f.revision, 'publiee_le', f.published_at,
      'role', pa.role, 'qualifications', pa.qualifications) order by f.date, f.shift_code, f.revision), '[]')
      from private.publication_assignees pa join private.publication_facts f on f.id = pa.publication_id
     where pa.user_id = (select id from compte)),
  'photographies_cloture', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'campagne', f.campaign_name, 'cloturee_le', f.closes_at, 'role', cp.role, 'actif', cp.active,
      'attendu', cp.expected, 'reponse_validee_le', cp.validated_at) order by f.closes_at), '[]')
      from private.closure_participants cp join private.closure_facts f on f.campaign_id = cp.campaign_id
     where cp.user_id = (select id from compte)),
  -- Le journal : ce que la personne a fait, et ce qui a été fait sur sa fiche.
  'journal', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'le', l.occurred_at, 'action', l.action, 'objet', l.entity,
      'par_elle', l.actor_id = (select id from compte),
      'avant', l.old_value, 'apres', l.new_value) order by l.occurred_at), '[]')
      from public.audit_logs l
     where l.actor_id = (select id from compte)
        or l.entity_id in ((select id::text from compte), (select lower(email) from compte))
        or l.old_value ->> 'user_id' = (select id::text from compte)
        or l.new_value ->> 'user_id' = (select id::text from compte))
)) as donnees;
