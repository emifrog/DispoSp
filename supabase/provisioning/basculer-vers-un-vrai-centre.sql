-- Quitter le centre d'essai pour un vrai centre.
--
-- Le nom d'un centre n'est modifiable par aucune session : la migration 0003 ne
-- donne au client le droit d'écrire que les horaires. Cette opération se fait
-- donc ici, dans l'éditeur SQL du tableau de bord Supabase, où la requête
-- s'exécute avec les droits du propriétaire.
--
-- Ce script crée le vrai centre, y rattache les comptes que vous nommez, puis
-- **efface le centre d'essai et tout ce qu'il contient** : campagnes,
-- disponibilités, plannings, affectations publiées comprises, désistements,
-- notifications et journal d'audit. C'est irréversible.
--
-- Exécutez d'abord `inventaire-du-centre.sql` : il dit, sans rien modifier, ce
-- qui va disparaître et qui est rattaché.
--
-- Ce que ce script ne touche pas : les **comptes d'authentification**. Ceux qui
-- ne sont pas repris ci-dessous restent, sans rattachement — ils pourront se
-- connecter et l'application leur dira qu'ils n'appartiennent à aucun centre.
-- Pour les faire disparaître vraiment, `retirer-un-compte.sql`, puis
-- Authentication → Users dans le tableau de bord.
--
-- Adaptez les cinq valeurs ci-dessous, puis exécutez le fichier entier.
--
-- Pas de begin/commit autour : un bloc `do` est déjà une instruction unique,
-- donc atomique. Une erreur, quelle qu'elle soit, annule la création comme
-- l'effacement — jamais de moitié de bascule.

do $$
declare
  -- Le vrai centre.
  centre_nom    constant text := 'CIS Nice Bon Voyage';
  -- Une seule section : elle s'affiche à côté du nom du centre dans l'en-tête.
  -- Le centre peut en compter d'autres plus tard, depuis Agents & équipes.
  section_nom   constant text := 'Bon Voyage';
  -- Le compte qui administre le nouveau centre. Il doit exister et son adresse
  -- être confirmée. C'est le seul rôle qui puisse ensuite rattacher les autres.
  admin_email   constant text := 'administrateur@exemple.fr';
  -- Ceux qui le suivent, comme agents. Laissez le tableau vide s'il n'y en a
  -- pas : « array[]::text[] ». Le compte de recette a sa place ici.
  suivent       constant text[] := array['agent.de.recette@exemple.fr'];
  -- Le centre d'essai, à effacer. Mettez NULL pour ne rien effacer du tout.
  essai_nom     constant text := 'CIS Test';

  admin_id uuid;
  confirmed timestamptz;
  centre_id uuid;
  section_id uuid;
  essai_id uuid;
  jour smallint := 8;
  nuit smallint := 20;
  compte text;
  compte_id uuid;
begin
  -- 1. Les refus, tous avant la moindre écriture.

  select id, email_confirmed_at into admin_id, confirmed from auth.users where email = admin_email;
  if admin_id is null then
    raise exception 'Aucun compte pour %. Inscrivez-vous d''abord depuis la page de connexion.', admin_email;
  end if;
  if confirmed is null then
    raise exception 'Le compte % existe mais son adresse n''est pas confirmée.', admin_email;
  end if;
  if exists (select 1 from public.organizations where name = centre_nom) then
    raise exception 'Un centre nommé « % » existe déjà. Ce script ne s''exécute qu''une fois.', centre_nom;
  end if;
  if essai_nom is not null then
    select id into essai_id from public.organizations where name = essai_nom;
    if essai_id is null then
      raise notice 'Aucun centre nommé « % » : rien à effacer, la création se fait quand même.', essai_nom;
    end if;
  end if;
  -- Un compte n'a qu'un rattachement par centre : le nommer deux fois ferait
  -- échouer la bascule tout à la fin, sur une violation de clé primaire, et le
  -- message ne dirait rien de la cause. C'est fréquent quand l'administrateur
  -- est aussi le compte de recette.
  if admin_email = any(suivent) then
    raise exception 'Le compte % administre déjà le centre : retirez-le de « suivent ».', admin_email;
  end if;
  if coalesce(array_length(suivent, 1), 0) <> (select count(distinct x) from unnest(suivent) as x) then
    raise exception 'La liste « suivent » nomme deux fois le même compte.';
  end if;
  foreach compte in array suivent loop
    if not exists (select 1 from auth.users where email = compte and email_confirmed_at is not null) then
      raise exception 'Le compte % n''existe pas, ou son adresse n''est pas confirmée.', compte;
    end if;
  end loop;
  -- Un compte n'est actif que dans un seul centre à la fois : la lecture de
  -- session refuse deux rattachements actifs, et le schéma le garantit depuis
  -- le 22 septembre. Ceux du centre d'essai partent avec lui ; un compte actif
  -- dans un autre centre — ou dans l'essai qu'on ne veut pas effacer — doit y
  -- être désactivé d'abord.
  foreach compte in array suivent || admin_email loop
    if exists (
      select 1 from public.memberships m join auth.users u on u.id = m.user_id
       where u.email = compte and m.active and m.organization_id is distinct from essai_id
    ) then
      raise exception 'Le compte % est encore actif dans un autre centre : désactivez-l''y avant de le rattacher ici.', compte;
    end if;
  end loop;

  -- 2. Le vrai centre.

  -- Les horaires du centre d'essai, s'il en avait : ils ont sans doute été
  -- réglés pour de bon, et les recréer par défaut serait une régression muette.
  -- Lus sur l'organisation, la seule ligne que l'application écrit (écran
  -- Paramètres) : shift_types n'est renseignée que par les scripts, et ne suit
  -- pas un réglage fait depuis l'application.
  if essai_id is not null then
    select coalesce(o.day_start, 8), coalesce(o.night_start, 20)
      into jour, nuit
      from public.organizations o where o.id = essai_id;
  end if;

  insert into public.organizations (name, day_start, night_start) values (centre_nom, jour, nuit)
    returning id into centre_id;
  insert into public.teams (organization_id, name) values (centre_id, section_nom) returning id into section_id;
  insert into public.shift_types (organization_id, code, starts_at_hour, duration_hours)
    values (centre_id, 'DAY', jour, 12), (centre_id, 'NIGHT', nuit, 12);
  insert into public.qualifications (organization_id, name)
    values (centre_id, 'Chef'), (centre_id, 'Conducteur PL'), (centre_id, 'SAP'), (centre_id, 'Équipier INC');

  -- 3. L'effacement du centre d'essai.
  --
  -- Toutes les clés étrangères entre ces tables sont en « on delete restrict » :
  -- rien ne part en cascade, on efface dans l'ordre ou la transaction échoue.
  -- L'ordre va du plus dépendant au plus porteur, et le journal d'audit passe en
  -- dernier — les effacements ci-dessous y écrivent encore.

  if essai_id is not null then
    -- Le garde des disponibilités refuse toute écriture sur une campagne close
    -- ou verrouillée, effacement compris. C'est exactement ce qu'il doit faire
    -- pour une session ; ici il empêcherait de démonter le centre. Il est rendu
    -- à la fin du bloc, et une erreur annulerait aussi cette mise en sommeil.
    alter table public.availability_entries disable trigger availability_write;

    delete from public.push_deliveries d using public.push_subscriptions s
      where d.subscription_id = s.id and s.organization_id = essai_id;
    delete from public.push_subscriptions where organization_id = essai_id;
    delete from public.availability_entries e using public.availability_campaigns c
      where e.campaign_id = c.id and c.organization_id = essai_id;
    delete from public.availability_templates where organization_id = essai_id;
    delete from public.shift_withdrawals where organization_id = essai_id;
    delete from public.schedule_assignments where organization_id = essai_id;
    delete from public.schedule_shifts where organization_id = essai_id;
    delete from public.schedules where organization_id = essai_id;
    delete from public.staffing_requirement_qualifications where organization_id = essai_id;
    delete from public.staffing_requirements where organization_id = essai_id;
    delete from public.campaign_participants where organization_id = essai_id;
    delete from public.availability_campaigns where organization_id = essai_id;
    delete from public.notifications where organization_id = essai_id;
    delete from public.user_qualifications where organization_id = essai_id;
    delete from public.qualifications where organization_id = essai_id;
    delete from public.invitations where organization_id = essai_id;
    -- Le journal des envois survit aux invitations : il part avec le centre.
    delete from private.invitation_sends where organization_id = essai_id;

    -- Le journal en dernier : chacun des effacements ci-dessus y a encore
    -- écrit, par les déclencheurs d'audit de 0003 et 0004.
    delete from public.audit_logs where organization_id = essai_id;
    delete from public.memberships where organization_id = essai_id;
    delete from public.shift_types where organization_id = essai_id;
    delete from public.teams where organization_id = essai_id;
    delete from public.organizations where id = essai_id;

    alter table public.availability_entries enable trigger availability_write;
    raise notice 'Centre « % » effacé, avec ses campagnes, ses plannings et son journal.', essai_nom;
  end if;

  -- 4. Les rattachements, une fois la place libre.
  --
  -- Après l'effacement et non avant : un compte n'a qu'un rattachement actif, et
  -- l'ancien vient seulement de disparaître.

  insert into public.profiles (user_id, display_name)
    values (admin_id, split_part(admin_email, '@', 1))
    on conflict (user_id) do nothing;
  insert into public.memberships (organization_id, user_id, team_id, role, active)
    values (centre_id, admin_id, section_id, 'ADMIN', true);

  foreach compte in array suivent loop
    select id into compte_id from auth.users where email = compte;
    insert into public.profiles (user_id, display_name)
      values (compte_id, split_part(compte, '@', 1))
      on conflict (user_id) do nothing;
    insert into public.memberships (organization_id, user_id, team_id, role, active)
      values (centre_id, compte_id, section_id, 'AGENT', true);
  end loop;

  raise notice 'Centre « % » créé (%), section « % », % compte(s) rattaché(s). Jour % h, nuit % h.',
    centre_nom, centre_id, section_nom, 1 + coalesce(array_length(suivent, 1), 0), jour, nuit;
  raise notice 'Ouvrez l''application : la fiche de chacun se complète dans Agents & équipes, puis ouvrez la première campagne.';
end
$$;

-- Les comptes d'authentification du centre d'essai qui n'ont pas été repris
-- existent toujours. Pour les retrouver :
--
--   select u.email from auth.users u
--    where not exists (select 1 from public.memberships m where m.user_id = u.id)
--    order by u.email;
