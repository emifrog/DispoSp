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
async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  // Applied in order, exactly as they are against the real project: the tests
  // therefore check the migration sequence, not a single hand-kept schema file.
  for (const migration of ["0001_foundation.sql", "0002_planning.sql"])
    await db.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  await db.exec(`insert into auth.users values ('${agentA}'), ('${agentB}'), ('${managerA}');
    insert into public.profiles values ('${agentA}', 'Agent A'), ('${agentB}', 'Agent B'), ('${managerA}', 'Responsable A');
    insert into public.organizations(id,name) values ('${orgA}','Centre A'), ('${orgB}','Centre B');
    insert into public.teams(id,organization_id,name) values ('${teamA}','${orgA}','Alpha'), ('${teamB}','${orgB}','Bravo');
    insert into public.memberships values ('${orgA}','${agentA}','${teamA}','AGENT',true), ('${orgB}','${agentB}','${teamB}','AGENT',true), ('${orgA}','${managerA}','${teamA}','RESPONSABLE',true);
    insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values ('${campaignA}','${orgA}','${teamA}','Octobre','2026-10-01','2026-10-02',now()-interval '1 day',now()+interval '1 day'), ('${campaignB}','${orgB}','${teamB}','Octobre','2026-10-01','2026-10-02',now()-interval '1 day',now()+interval '1 day');
    insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${orgA}','${campaignA}','${agentA}'), ('${orgB}','${campaignB}','${agentB}');`);
}, 30000);
afterAll(async () => {
  await db.close();
});
describe("Fondation Supabase — droits PostgreSQL réels", () => {
  it("isole les organisations et interdit l’auto-promotion", async () => {
    await asUser(agentA);
    expect((await db.query("select id from public.organizations")).rows).toEqual([{ id: orgA }]);
    expect((await db.query("select id from public.availability_campaigns")).rows).toEqual([{ id: campaignA }]);
    await expect(db.query("update public.memberships set role = 'ADMIN' where user_id=$1", [agentA])).rejects.toThrow();
    await expect(
      db.query(
        "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')",
        [campaignB, agentB],
      ),
    ).rejects.toThrow();
  });
  it("refuse une validation incomplète et valide explicitement un mois complet", async () => {
    await asUser(agentA);
    await db.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')",
      [campaignA, agentA],
    );
    await expect(
      db.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
        campaignA,
        agentA,
      ]),
    ).rejects.toThrow("Complete all dates");
    await db.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-02','UNAVAILABLE')",
      [campaignA, agentA],
    );
    expect(
      (await db.query<{ validated_at: unknown }>("select validated_at from public.campaign_participants")).rows[0]
        .validated_at,
    ).toBeNull();
    await db.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
      campaignA,
      agentA,
    ]);
    expect(
      (await db.query<{ validated_at: unknown }>("select validated_at from public.campaign_participants")).rows[0]
        .validated_at,
    ).not.toBeNull();
  });
  it("invalide après modification et interdit transfert de propriétaire ou date hors campagne", async () => {
    await asUser(agentA);
    await db.query("update public.availability_entries set availability_type='FULL_24H' where date='2026-10-01'");
    expect(
      (await db.query<{ validated_at: unknown }>("select validated_at from public.campaign_participants")).rows[0]
        .validated_at,
    ).toBeNull();
    await expect(db.query("update public.availability_entries set user_id=$1", [agentB])).rejects.toThrow();
    await expect(
      db.query(
        "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-03','DAY')",
        [campaignA, agentA],
      ),
    ).rejects.toThrow("Date outside campaign");
  });
  it("permet la lecture responsable et le verrouillage, puis refuse la saisie agent", async () => {
    await asUser(managerA);
    expect((await db.query("select * from public.availability_entries")).rows).toHaveLength(2);
    await db.query("update public.availability_campaigns set locked=true where id=$1", [campaignA]);
    await asUser(agentA);
    await expect(db.query("update public.availability_entries set comment='late'")).rejects.toThrow(
      "Campaign is closed",
    );
  });
  it("ne laisse pas l’autre organisation lire les saisies", async () => {
    await asUser(agentB);
    expect((await db.query("select * from public.availability_entries")).rows).toHaveLength(0);
  });
});

// A second organisation, untouched by the tests above which lock and invalidate
// their campaign, so the planning flow starts from a clean, realistic state.
const orgC = "10000000-0000-0000-0000-000000000003";
const teamC = "20000000-0000-0000-0000-000000000003";
const chief = "30000000-0000-0000-0000-000000000004";
const rookie = "30000000-0000-0000-0000-000000000005";
const rookie2 = "30000000-0000-0000-0000-000000000007";
const managerC = "30000000-0000-0000-0000-000000000006";
const campaignC = "40000000-0000-0000-0000-000000000003";
const qualChief = "50000000-0000-0000-0000-000000000001";
const qualSap = "50000000-0000-0000-0000-000000000002";
const scheduleC = "60000000-0000-0000-0000-000000000001";
const shiftC = "70000000-0000-0000-0000-000000000001";
const requirementC = "80000000-0000-0000-0000-000000000001";

describe("Planning, publication et audit", () => {
  beforeAll(async () => {
    await db.exec("reset role");
    await db.exec(`insert into auth.users values ('${chief}'), ('${rookie}'), ('${rookie2}'), ('${managerC}');
      insert into public.profiles values ('${chief}','Chef C'), ('${rookie}','Équipier C'), ('${rookie2}','Équipier C bis'), ('${managerC}','Gestionnaire C');
      insert into public.organizations(id,name) values ('${orgC}','Centre C');
      insert into public.teams(id,organization_id,name) values ('${teamC}','${orgC}','Charlie');
      insert into public.memberships values
        ('${orgC}','${chief}','${teamC}','AGENT',true),
        ('${orgC}','${rookie}','${teamC}','AGENT',true),
        ('${orgC}','${rookie2}','${teamC}','AGENT',true),
        ('${orgC}','${managerC}','${teamC}','GESTIONNAIRE',true);
      insert into public.qualifications(id,organization_id,name) values ('${qualChief}','${orgC}','Chef'), ('${qualSap}','${orgC}','SAP');
      insert into public.user_qualifications(organization_id,user_id,qualification_id) values
        ('${orgC}','${chief}','${qualChief}'), ('${orgC}','${chief}','${qualSap}'), ('${orgC}','${rookie}','${qualSap}'), ('${orgC}','${rookie2}','${qualSap}');
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaignC}','${orgC}','${teamC}','Novembre','2026-11-01','2026-11-02',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${orgC}','${campaignC}','${chief}'), ('${orgC}','${campaignC}','${rookie}'), ('${orgC}','${campaignC}','${rookie2}');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${scheduleC}','${orgC}','${campaignC}','${teamC}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code) values ('${shiftC}','${orgC}','${scheduleC}','2026-11-01','DAY');
      insert into public.staffing_requirements(id,organization_id,campaign_id,date,shift_code,headcount)
        values ('${requirementC}','${orgC}','${campaignC}','2026-11-01','DAY',2);
      insert into public.staffing_requirement_qualifications(organization_id,requirement_id,qualification_id,minimum)
        values ('${orgC}','${requirementC}','${qualChief}',1);`);
    // Each agent fills the whole campaign, then validates: the real sequence.
    for (const agent of [chief, rookie, rookie2]) {
      await asUser(agent);
      await db.query(
        `insert into public.availability_entries(campaign_id,user_id,date,availability_type)
         values ($1,$2,'2026-11-01','FULL_24H'), ($1,$2,'2026-11-02','UNAVAILABLE')`,
        [campaignC, agent],
      );
      await db.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
        campaignC,
        agent,
      ]);
    }
  }, 30000);

  it("refuse une exigence de qualification supérieure à l’effectif requis", async () => {
    await asUser(managerC);
    await expect(
      db.query("update public.staffing_requirement_qualifications set minimum=5 where requirement_id=$1", [
        requirementC,
      ]),
    ).rejects.toThrow("exceeds the required headcount");
  });

  it("bloque la publication tant que l’effectif ou les qualifications manquent", async () => {
    await asUser(managerC);
    await expect(db.query("select private.publish_schedule_shift($1)", [shiftC])).rejects.toThrow("Headcount");
    await db.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [orgC, shiftC, rookie, managerC],
    );
    await expect(db.query("select private.publish_schedule_shift($1)", [shiftC])).rejects.toThrow("Headcount");
    // Headcount now reached, both available and validated, but neither holds
    // "Chef": meeting the total never proves the qualifications are covered.
    await db.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [orgC, shiftC, rookie2, managerC],
    );
    await expect(db.query("select private.publish_schedule_shift($1)", [shiftC])).rejects.toThrow("Qualifications");
  });

  it("refuse une affectation sans disponibilité validée correspondante", async () => {
    await asUser(managerC);
    // The manager never answered the campaign, so they are not assignable. This
    // is checked before headcount and qualifications.
    await db.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [orgC, shiftC, managerC, managerC],
    );
    await expect(db.query("select private.publish_schedule_shift($1)", [shiftC])).rejects.toThrow(
      "validated matching availability",
    );
    await db.query("delete from public.schedule_assignments where schedule_shift_id=$1 and user_id=$2", [
      shiftC,
      managerC,
    ]);
  });

  it("publie un créneau couvert, notifie les agents et journalise l’ancienne et la nouvelle valeur", async () => {
    await asUser(managerC);
    // Swap the second SAP for the chief: headcount and qualifications now hold.
    await db.query("delete from public.schedule_assignments where schedule_shift_id=$1 and revision=0 and user_id=$2", [
      shiftC,
      rookie2,
    ]);
    await db.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [orgC, shiftC, chief, managerC],
    );
    const published = await db.query<{ publish_schedule_shift: number }>("select private.publish_schedule_shift($1)", [
      shiftC,
    ]);
    expect(published.rows[0].publish_schedule_shift).toBe(1);

    const shift = await db.query<{ published_revision: number; published_at: unknown }>(
      "select published_revision, published_at from public.schedule_shifts where id=$1",
      [shiftC],
    );
    expect(shift.rows[0].published_revision).toBe(1);
    expect(shift.rows[0].published_at).not.toBeNull();

    const audit = await db.query<{ action: string; old_value: { revision: number }; new_value: { revision: number } }>(
      "select action, old_value, new_value from public.audit_logs where entity_id=$1 order by id desc limit 1",
      [shiftC],
    );
    expect(audit.rows[0].action).toBe("PUBLISH");
    expect(audit.rows[0].old_value.revision).toBe(0);
    expect(audit.rows[0].new_value.revision).toBe(1);

    await asUser(chief);
    expect((await db.query("select 1 from public.notifications where kind='SCHEDULE_PUBLISHED'")).rows).toHaveLength(1);
  });

  it("garde la version publiée intacte quand le brouillon change ensuite", async () => {
    await asUser(managerC);
    await db.query("delete from public.schedule_assignments where schedule_shift_id=$1 and revision=0 and user_id=$2", [
      shiftC,
      rookie,
    ]);
    const draft = await db.query(
      "select user_id from public.schedule_assignments where schedule_shift_id=$1 and revision=0",
      [shiftC],
    );
    expect(draft.rows).toEqual([{ user_id: chief }]);
    const publishedRows = await db.query(
      "select user_id from public.schedule_assignments where schedule_shift_id=$1 and revision=1",
      [shiftC],
    );
    expect(publishedRows.rows).toHaveLength(2);
  });

  it("n’expose à l’agent que sa garde publiée, jamais le brouillon", async () => {
    await asUser(rookie);
    // Removed from the draft, but still in the published revision agents see.
    const rows = await db.query<{ revision: number; status: string }>(
      "select revision, status from public.schedule_assignments",
    );
    expect(rows.rows).toEqual([{ revision: 1, status: "CONFIRMED" }]);
    await asUser(agentB);
    expect((await db.query("select * from public.schedule_assignments")).rows).toHaveLength(0);
  });

  it("interdit d’écrire une révision publiée ou de forcer l’état de publication", async () => {
    await asUser(managerC);
    await expect(
      db.query(
        "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,assigned_by) values ($1,$2,$3,9,$4)",
        [orgC, shiftC, rookie, managerC],
      ),
    ).rejects.toThrow();
    // A delete filtered out by RLS removes nothing rather than raising, so the
    // guarantee to assert is that the published revision is still intact.
    await db.query("delete from public.schedule_assignments where schedule_shift_id=$1 and revision=1", [shiftC]);
    await db.exec("reset role");
    expect(
      (await db.query("select 1 from public.schedule_assignments where schedule_shift_id=$1 and revision=1", [shiftC]))
        .rows,
    ).toHaveLength(2);
    await asUser(managerC);
    await expect(
      db.query("update public.schedule_shifts set published_revision=99 where id=$1", [shiftC]),
    ).rejects.toThrow();
  });

  it("réserve le journal d’audit aux profils autorisés", async () => {
    await asUser(chief);
    expect((await db.query("select * from public.audit_logs")).rows).toHaveLength(0);
    await asUser(managerA);
    expect((await db.query("select * from public.audit_logs")).rows).toHaveLength(0);
    await asUser(managerC);
    expect((await db.query("select * from public.audit_logs")).rows.length).toBeGreaterThan(0);
  });
});

// The situation that produced "relation organizations already exists": a script
// meant for a fresh database replayed on one that already carries part of it.
describe("Enchaînement des migrations", () => {
  const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
  const authSchema = `create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`;

  it("refuse 0002 sur une base qui n’a jamais reçu 0001", async () => {
    const fresh = new PGlite();
    await fresh.exec(authSchema);
    await expect(fresh.exec(read("0002_planning.sql"))).rejects.toThrow("Apply 0001_foundation.sql first");
    await fresh.close();
  }, 30000);

  it("refuse 0002 une seconde fois, sans rien laisser derrière", async () => {
    const fresh = new PGlite();
    await fresh.exec(authSchema);
    await fresh.exec(read("0001_foundation.sql"));
    await fresh.exec(read("0002_planning.sql"));
    // PGlite surfaces the follow-on "transaction is aborted" rather than the
    // guard's own message here, so assert the property that matters instead:
    // the replay is refused and leaves the first application untouched.
    await expect(fresh.exec(read("0002_planning.sql"))).rejects.toThrow();
    // The session is left inside the aborted transaction; leave it before reading.
    await fresh.exec("rollback");
    const tables = await fresh.query<{ count: number }>(
      "select count(*)::int as count from information_schema.tables where table_schema='public'",
    );
    expect(tables.rows[0].count).toBe(17);
    await fresh.close();
  }, 30000);
});
