import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
const db = new PGlite();
const orgA = "10000000-0000-0000-0000-000000000001";
const orgB = "10000000-0000-0000-0000-000000000002";
const teamA = "20000000-0000-0000-0000-000000000001";
const teamB = "20000000-0000-0000-0000-000000000002";
const agentA = "30000000-0000-0000-0000-000000000001";
const agentB = "30000000-0000-0000-0000-000000000002";
const managerA = "30000000-0000-0000-0000-000000000003";
const campaignA = "40000000-0000-0000-0000-000000000001";
const campaignB = "40000000-0000-0000-0000-000000000002";
async function asUser(id: string) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec("set role authenticated"); }
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  await db.exec(`insert into auth.users values ('${agentA}'), ('${agentB}'), ('${managerA}');
    insert into public.profiles values ('${agentA}', 'Agent A'), ('${agentB}', 'Agent B'), ('${managerA}', 'Responsable A');
    insert into public.organizations(id,name) values ('${orgA}','Centre A'), ('${orgB}','Centre B');
    insert into public.teams(id,organization_id,name) values ('${teamA}','${orgA}','Alpha'), ('${teamB}','${orgB}','Bravo');
    insert into public.memberships values ('${orgA}','${agentA}','${teamA}','AGENT',true), ('${orgB}','${agentB}','${teamB}','AGENT',true), ('${orgA}','${managerA}','${teamA}','RESPONSABLE',true);
    insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values ('${campaignA}','${orgA}','${teamA}','Octobre','2026-10-01','2026-10-02',now()-interval '1 day',now()+interval '1 day'), ('${campaignB}','${orgB}','${teamB}','Octobre','2026-10-01','2026-10-02',now()-interval '1 day',now()+interval '1 day');
    insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${orgA}','${campaignA}','${agentA}'), ('${orgB}','${campaignB}','${agentB}');`);
}, 30000);
afterAll(async () => { await db.close(); });
describe("Fondation Supabase — droits PostgreSQL réels", () => {
  it("isole les organisations et interdit l’auto-promotion", async () => {
    await asUser(agentA);
    expect((await db.query("select id from public.organizations")).rows).toEqual([{ id: orgA }]);
    expect((await db.query("select id from public.availability_campaigns")).rows).toEqual([{ id: campaignA }]);
    await expect(db.query("update public.memberships set role = 'ADMIN' where user_id=$1", [agentA])).rejects.toThrow();
    await expect(db.query("insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')", [campaignB, agentB])).rejects.toThrow();
  });
  it("refuse une validation incomplète et valide explicitement un mois complet", async () => {
    await asUser(agentA);
    await db.query("insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')", [campaignA, agentA]);
    await expect(db.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [campaignA, agentA])).rejects.toThrow("Complete all dates");
    await db.query("insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-02','UNAVAILABLE')", [campaignA, agentA]);
    expect((await db.query<{ validated_at: unknown }>("select validated_at from public.campaign_participants")).rows[0].validated_at).toBeNull();
    await db.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [campaignA, agentA]);
    expect((await db.query<{ validated_at: unknown }>("select validated_at from public.campaign_participants")).rows[0].validated_at).not.toBeNull();
  });
  it("invalide après modification et interdit transfert de propriétaire ou date hors campagne", async () => {
    await asUser(agentA);
    await db.query("update public.availability_entries set availability_type='FULL_24H' where date='2026-10-01'");
    expect((await db.query<{ validated_at: unknown }>("select validated_at from public.campaign_participants")).rows[0].validated_at).toBeNull();
    await expect(db.query("update public.availability_entries set user_id=$1", [agentB])).rejects.toThrow();
    await expect(db.query("insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-03','DAY')", [campaignA, agentA])).rejects.toThrow("Date outside campaign");
  });
  it("permet la lecture responsable et le verrouillage, puis refuse la saisie agent", async () => {
    await asUser(managerA);
    expect((await db.query("select * from public.availability_entries")).rows).toHaveLength(2);
    await db.query("update public.availability_campaigns set locked=true where id=$1", [campaignA]);
    await asUser(agentA);
    await expect(db.query("update public.availability_entries set comment='late'")).rejects.toThrow("Campaign is closed");
  });
  it("ne laisse pas l’autre organisation lire les saisies", async () => {
    await asUser(agentB);
    expect((await db.query("select * from public.availability_entries")).rows).toHaveLength(0);
  });
});
