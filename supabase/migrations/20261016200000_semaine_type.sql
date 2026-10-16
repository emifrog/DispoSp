-- C4 de la revue d'ergonomie du 16 octobre 2026 (docs/AUDIT_ERGONOMIE_2026-10-16.md).
--
-- L'écran « Mes disponibilités » offrait quatre façons de saisir, qui toutes
-- écrasaient ce qui existait : un jour, une sélection multiple, la saisie
-- rapide (période ou jours de la semaine) et « Ma disponibilité habituelle »,
-- un modèle qu'il fallait enregistrer avant de pouvoir l'appliquer — sans quoi
-- le bouton restait grisé, sans un mot. La saisie rapide les réunit désormais
-- en deux onglets, « Période » et « Semaine type », et peut ne remplir que les
-- jours non renseignés.
--
-- apply_availability_template() n'y suffit pas : elle applique le modèle
-- enregistré, au mois entier, en écrasant tout, commentaires compris.
-- apply_week() applique une semaine donnée — une valeur par jour de semaine, ou
-- rien — sur une période de la campagne, en une seule écriture : tout le mois
-- ou rien, comme le modèle depuis le 18 septembre. Les règles de la saisie
-- restent celles du déclencheur : fenêtre ouverte, date dans la campagne,
-- réponse remise à valider.
--
-- L'ancienne fonction reste, pour un navigateur resté sur la version d'avant.
--
-- S'applique par-dessus 20261016150000. À coller en entier, **avant** de
-- déployer le code qui l'accompagne : la saisie rapide l'appelle.
begin;

do $$
begin
  if to_regproc('private.takes_shifts') is null then
    raise exception 'Appliquez d''abord 20261016150000_encadrement_hors_campagnes.sql';
  end if;
  if to_regproc('public.apply_week') is not null then
    raise exception 'Cette migration a déjà été appliquée à cette base';
  end if;
end
$$;

-- Les droits de la session, comme apply_availability_template() : les policies
-- de availability_entries décident de ce qu'elle peut écrire, et le déclencheur
-- check_availability_write() de quand.
create function public.apply_week(
  campaign uuid,
  week jsonb,
  first_day date,
  last_day date,
  keep_filled boolean,
  note text
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  c public.availability_campaigns;
  me uuid := (select auth.uid());
  written integer;
begin
  if me is null then
    raise exception 'Not allowed to apply a week to this campaign' using errcode = '42501';
  end if;
  select * into c from public.availability_campaigns where id = campaign;
  if c.id is null then
    raise exception 'Not allowed to apply a week to this campaign' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.campaign_participants p where p.campaign_id = campaign and p.user_id = me
  ) then
    raise exception 'Not a participant of this campaign' using errcode = '42501';
  end if;
  -- Sept clés au plus, de 1 (lundi) à 7, chacune une disponibilité ou rien.
  if week is null or jsonb_typeof(week) <> 'object' or exists (
    select 1 from jsonb_each(week) w(day, value)
     where w.day not in ('1', '2', '3', '4', '5', '6', '7')
        or not (jsonb_typeof(w.value) = 'null'
                or (jsonb_typeof(w.value) = 'string'
                    and w.value #>> '{}' in ('DAY', 'NIGHT', 'FULL_24H', 'UNAVAILABLE')))
  ) then
    raise exception 'Invalid availability week' using errcode = '22023';
  end if;
  if first_day is null or last_day is null or first_day > last_day then
    raise exception 'Invalid availability period' using errcode = '22023';
  end if;
  if length(coalesce(note, '')) > 500 then
    raise exception 'Availability comment is too long' using errcode = '22023';
  end if;

  -- Des décalages entiers, comme pour les créneaux de la campagne : aucune
  -- dépendance au fuseau de la connexion. La période est ramenée à la campagne.
  insert into public.availability_entries (campaign_id, user_id, date, availability_type, comment)
  select campaign, me, day.date, w.value #>> '{}', coalesce(btrim(note), '')
    from generate_series(0, least(last_day, c.ends_on) - greatest(first_day, c.starts_on)) as offsets(n)
    cross join lateral (select (greatest(first_day, c.starts_on) + offsets.n)::date) as day(date)
    join jsonb_each(week) w(day, value)
      on w.day::int = extract(isodow from day.date) and jsonb_typeof(w.value) = 'string'
   where not keep_filled
      or not exists (
        select 1 from public.availability_entries e
         where e.campaign_id = campaign and e.user_id = me and e.date = day.date
      )
  on conflict (campaign_id, user_id, date) do update
    set availability_type = excluded.availability_type, comment = excluded.comment;
  get diagnostics written = row_count;
  return written;
end;
$$;
revoke all on function public.apply_week(uuid, jsonb, date, date, boolean, text) from public, anon, authenticated;
grant execute on function public.apply_week(uuid, jsonb, date, date, boolean, text) to authenticated;

commit;
