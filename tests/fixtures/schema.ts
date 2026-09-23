import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

/**
 * Le schéma, tel qu'il est appliqué au vrai projet.
 *
 * Partagé par les parcours de base et ceux du provisionnement : deux listes de
 * migrations finiraient par diverger, et la seconde vérifierait alors un schéma
 * qui n'existe nulle part.
 */
export const MIGRATIONS = [
  "0001_foundation.sql",
  "0002_planning.sql",
  "0003_client_writes.sql",
  "0004_agent_administration.sql",
  "0005_notifications.sql",
  "0006_email_dispatch.sql",
  "0007_availability_templates.sql",
  "20260918151529_atomic_campaign_creation.sql",
  "20260918180846_atomic_availability_templates.sql",
  "20260919120000_grades_fonctions_roles.sql",
  "20260919200000_desistements.sql",
  "20260920090000_correctifs_droits_et_besoins.sql",
  "20260920140000_invitation_compte_existant.sql",
  "20260921090000_eligibilite_publication.sql",
  "20260921100156_web_push_notifications.sql",
  "20260921130000_web_push_abonnement.sql",
  "20260921140000_verrou_publication.sql",
  "20260922100000_reactivation_administrateur_devalidation.sql",
  "20260922150000_rattachement_retrait_file_email.sql",
  "20260923090000_fiche_agent_atomique.sql",
  "20260923140000_limites_envois.sql",
  "20260923180000_rendre_envoi_invitation.sql",
];

/**
 * Ce que Supabase fournit avant toute migration : les rôles, le schéma
 * d'authentification et `auth.uid()`.
 *
 * `service_role` est le compte du serveur, et il passe outre les policies : la
 * file d'envoi des notifications poussées se lit pour tout un centre, ce
 * qu'aucune session d'agent ne pourrait faire. Sans lui, la migration Web Push
 * ne s'appliquerait même pas.
 */
export const baseAuthSchema = `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role; alter default privileges in schema public grant all on tables to service_role; alter default privileges in schema public grant all on functions to service_role;`;

/** Une base neuve, schéma d'authentification et migrations appliqués dans l'ordre. */
export async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(baseAuthSchema);
  for (const migration of MIGRATIONS)
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  return db;
}

/** Un fichier de `supabase/provisioning/`, tel qu'il sera collé dans l'éditeur SQL. */
export const provisioningScript = (name: string) =>
  readFileSync(new URL(`../../supabase/provisioning/${name}`, import.meta.url), "utf8");
