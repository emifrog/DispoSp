import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
const db = new PGlite();
// Applied in order everywhere below, exactly as against the real project.
const MIGRATIONS = [
  "0001_foundation.sql",
  "0002_planning.sql",
  "0003_client_writes.sql",
  "0004_agent_administration.sql",
];
const baseAuthSchema = `create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`;
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
    `create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  // Applied in order, exactly as they are against the real project: the tests
  // therefore check the migration sequence, not a single hand-kept schema file.
  for (const migration of MIGRATIONS)
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
    // Since 0004 the column grant exists, so the refusal is a policy filtering the
    // row rather than an error. The guarantee is the role, not the exception.
    await db.query("update public.memberships set role = 'ADMIN' where user_id=$1", [agentA]);
    expect((await db.query("select role from public.memberships where user_id=$1", [agentA])).rows).toEqual([
      { role: "AGENT" },
    ]);
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
  const authSchema = `create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`;

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

// The provisioning scripts are templates whose top declarations get edited by
// whoever runs them. Substituting by variable name rather than by the placeholder
// value keeps these tests working whatever is currently typed in the file.
function withValues(sql: string, values: Record<string, string>) {
  return Object.entries(values).reduce((out, [name, value]) => {
    const declaration = new RegExp(`(${name}\\s+constant text\\s*:=\\s*')[^']*'`);
    if (!declaration.test(out)) throw new Error(`Déclaration « ${name} » introuvable dans le script.`);
    return out.replace(declaration, `$1${value}'`);
  }, sql);
}

// The provisioning script is pasted by hand into the Supabase SQL editor, so it
// gets the same scrutiny as the migrations: run it against a real engine first.
describe("Provisionnement de la première organisation", () => {
  const authSchema = `create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`;
  const script = () =>
    readFileSync(new URL("../supabase/provisioning/premiere-organisation.sql", import.meta.url), "utf8");
  const forEmail = (email: string) =>
    withValues(script(), { admin_email: email, org_name: "CIS Test", team_name: "Section Test" });

  async function ready() {
    const fresh = new PGlite();
    await fresh.exec(authSchema);
    for (const m of MIGRATIONS)
      await fresh.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return fresh;
  }

  it("refuse un compte inexistant, puis un compte non confirmé", async () => {
    const fresh = await ready();
    await expect(fresh.exec(forEmail("absent@example.org"))).rejects.toThrow();
    await fresh.exec("rollback");
    await fresh.query("insert into auth.users(id,email) values (gen_random_uuid(), 'entrant@example.org')");
    await expect(fresh.exec(forEmail("entrant@example.org"))).rejects.toThrow();
    await fresh.exec("rollback");
    expect((await fresh.query("select 1 from public.organizations")).rows).toHaveLength(0);
    await fresh.close();
  }, 30000);

  it("rattache un compte confirmé et refuse de s’exécuter deux fois", async () => {
    const fresh = await ready();
    await fresh.query(
      "insert into auth.users(id,email,email_confirmed_at) values (gen_random_uuid(), 'chef@example.org', now())",
    );
    await fresh.exec(forEmail("chef@example.org"));

    const membership = await fresh.query<{ role: string; name: string }>(
      `select m.role, o.name from public.memberships m join public.organizations o on o.id = m.organization_id`,
    );
    expect(membership.rows).toEqual([{ role: "ADMIN", name: "CIS Test" }]);
    expect((await fresh.query("select 1 from public.qualifications")).rows).toHaveLength(4);
    expect((await fresh.query("select 1 from public.shift_types")).rows).toHaveLength(2);

    await expect(fresh.exec(forEmail("chef@example.org"))).rejects.toThrow();
    await fresh.exec("rollback");
    expect((await fresh.query("select 1 from public.organizations")).rows).toHaveLength(1);
    await fresh.close();
  }, 30000);

  it("laisse l’administrateur lire son organisation sous RLS", async () => {
    const fresh = await ready();
    const inserted = await fresh.query<{ id: string }>(
      "insert into auth.users(id,email,email_confirmed_at) values (gen_random_uuid(), 'chef@example.org', now()) returning id",
    );
    await fresh.exec(forEmail("chef@example.org"));
    // The whole point of the provisioning: the account can now see something.
    await fresh.exec("reset role");
    await fresh.query("select set_config('request.jwt.claim.sub', $1, false)", [inserted.rows[0].id]);
    await fresh.exec("set role authenticated");
    expect((await fresh.query("select name from public.organizations")).rows).toEqual([{ name: "CIS Test" }]);
    expect((await fresh.query("select role from public.memberships")).rows).toEqual([{ role: "ADMIN" }]);
    expect((await fresh.query("select 1 from public.qualifications")).rows).toHaveLength(4);
    await fresh.close();
  }, 30000);
});

describe("Ouverture de la première campagne", () => {
  const authSchema = `create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to authenticated; grant execute on function auth.uid() to authenticated;`;
  const file = (name: string) => readFileSync(new URL(`../supabase/provisioning/${name}`, import.meta.url), "utf8");

  async function provisioned() {
    const fresh = new PGlite();
    await fresh.exec(authSchema);
    for (const m of MIGRATIONS)
      await fresh.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await fresh.query(
      "insert into auth.users(id,email,email_confirmed_at) values (gen_random_uuid(), 'chef@example.org', now())",
    );
    await fresh.exec(
      withValues(file("premiere-organisation.sql"), {
        admin_email: "chef@example.org",
        org_name: "CIS Test",
        team_name: "Section Test",
      }),
    );
    return fresh;
  }

  it("refuse une organisation inconnue", async () => {
    const fresh = await provisioned();
    await expect(
      fresh.exec(withValues(file("premiere-campagne.sql"), { org_name: "Centre absent", team_name: "Section Test" })),
    ).rejects.toThrow();
    await fresh.exec("rollback");
    await fresh.close();
  }, 30000);

  it("ouvre une campagne cohérente, invite l’équipe et prépare les créneaux", async () => {
    const fresh = await provisioned();
    await fresh.exec(file("premiere-campagne.sql"));

    const campaign = await fresh.query<{
      starts_on: string;
      ends_on: string;
      day_start: number;
      night_start: number;
      ouverte: boolean;
    }>(`select starts_on, ends_on, day_start, night_start,
               (now() between opens_at and closes_at) as ouverte
          from public.availability_campaigns`);
    expect(campaign.rows).toHaveLength(1);
    const row = campaign.rows[0];
    // Le mois prochain, du premier au dernier jour, et ouverte à la saisie dès maintenant.
    expect(new Date(row.starts_on).getUTCDate()).toBe(1);
    expect(new Date(row.ends_on).getUTCMonth()).toBe(new Date(row.starts_on).getUTCMonth());
    expect(new Date(new Date(row.ends_on).getTime() + 86400000).getUTCDate()).toBe(1);
    expect(row.day_start).toBe(8);
    expect(row.night_start).toBe(20);
    expect(row.ouverte).toBe(true);

    expect((await fresh.query("select 1 from public.campaign_participants")).rows).toHaveLength(1);
    expect((await fresh.query("select 1 from public.schedules")).rows).toHaveLength(1);
    const shifts = await fresh.query<{ count: number }>("select count(*)::int as count from public.schedule_shifts");
    const days = (new Date(row.ends_on).getTime() - new Date(row.starts_on).getTime()) / 86400000 + 1;
    expect(shifts.rows[0].count).toBe(days * 2);

    await expect(fresh.exec(file("premiere-campagne.sql"))).rejects.toThrow();
    await fresh.exec("rollback");
    expect((await fresh.query("select 1 from public.availability_campaigns")).rows).toHaveLength(1);
    await fresh.close();
  }, 30000);

  it("laisse l’agent saisir puis valider sa réponse sous RLS", async () => {
    const fresh = await provisioned();
    await fresh.exec(file("premiere-campagne.sql"));
    const me = await fresh.query<{ id: string }>("select id from auth.users where email='chef@example.org'");
    const campaign = await fresh.query<{ id: string; starts_on: string; ends_on: string }>(
      "select id, starts_on, ends_on from public.availability_campaigns",
    );
    await fresh.exec("reset role");
    await fresh.query("select set_config('request.jwt.claim.sub', $1, false)", [me.rows[0].id]);
    await fresh.exec("set role authenticated");

    // Ce que fera l'écran agent : renseigner chaque jour, puis valider.
    await fresh.query(
      `insert into public.availability_entries(campaign_id,user_id,date,availability_type)
       select $1, $2, d::date, 'FULL_24H' from generate_series($3::date, $4::date, interval '1 day') d`,
      [campaign.rows[0].id, me.rows[0].id, campaign.rows[0].starts_on, campaign.rows[0].ends_on],
    );
    await fresh.query("update public.campaign_participants set validated_at = now()");
    const validated = await fresh.query<{ validated_at: unknown }>(
      "select validated_at from public.campaign_participants",
    );
    expect(validated.rows[0].validated_at).not.toBeNull();
    await fresh.close();
  }, 30000);
});

// 0003 opens exactly four doors that 0001/0002 kept shut. Each one is checked
// against a real engine, because a policy that silently filters rows instead of
// refusing them is indistinguishable from a working write until it is too late.
describe("Écritures ouvertes par 0003", () => {
  const org = "10000000-0000-0000-0000-000000000009";
  const team = "20000000-0000-0000-0000-000000000009";
  const admin = "30000000-0000-0000-0000-000000000009";
  const chief = "30000000-0000-0000-0000-000000000010";
  const campaign = "40000000-0000-0000-0000-000000000009";
  const schedule = "50000000-0000-0000-0000-000000000009";
  const shift = "60000000-0000-0000-0000-000000000009";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`insert into auth.users values ('${admin}'), ('${chief}');
      insert into public.profiles values ('${admin}','Administrateur'), ('${chief}','Chef');
      insert into public.organizations(id,name) values ('${org}','Centre 0003');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Delta');
      insert into public.memberships values ('${org}','${admin}','${team}','ADMIN',true), ('${org}','${chief}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${org}','${campaign}','${chief}');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code) values ('${shift}','${org}','${schedule}','2026-11-01','DAY');`);
    // The agent declares and validates: the real sequence, and the audit source.
    await be(chief);
    await live.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-11-01','FULL_24H')",
      [campaign, chief],
    );
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
      campaign,
      chief,
    ]);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("n’ouvre les horaires qu’à l’administration, et jamais le nom du centre", async () => {
    await be(chief);
    await live.query("update public.organizations set day_start = 7 where id = $1", [org]);
    // An RLS refusal on UPDATE filters rows instead of raising: read the value back.
    expect((await live.query("select day_start from public.organizations where id=$1", [org])).rows).toEqual([
      { day_start: 8 },
    ]);
    await be(admin);
    await live.query("update public.organizations set day_start = 7, night_start = 19 where id = $1", [org]);
    expect(
      (await live.query("select day_start, night_start from public.organizations where id=$1", [org])).rows,
    ).toEqual([{ day_start: 7, night_start: 19 }]);
    // A column grant, not a policy: this one really raises.
    await expect(live.query("update public.organizations set name='Renommé' where id=$1", [org])).rejects.toThrow();
  });

  it("n’ouvre le catalogue de qualifications qu’à l’administration", async () => {
    await be(chief);
    await expect(
      live.query("insert into public.qualifications(organization_id,name) values ($1,'SAP')", [org]),
    ).rejects.toThrow();
    await be(admin);
    await live.query("insert into public.qualifications(organization_id,name) values ($1,'SAP')", [org]);
    expect((await live.query("select name from public.qualifications where organization_id=$1", [org])).rows).toEqual([
      { name: "SAP" },
    ]);
  });

  it("expose la publication sans exposer le schéma privé", async () => {
    await be(admin);
    await live.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [org, shift, chief, admin],
    );
    // Reaching the wrapper is not enough: it must really run the definer function.
    await expect(live.query("select public.publish_shift($1)", [shift])).rejects.toThrow(
      "Define the staffing requirement",
    );
    await live.query(
      "insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount) values ($1,$2,'2026-11-01','DAY',1)",
      [org, campaign],
    );
    expect((await live.query<{ publish_shift: number }>("select public.publish_shift($1)", [shift])).rows).toEqual([
      { publish_shift: 1 },
    ]);
  });

  it("journalise l’ancienne et la nouvelle valeur, sans laisser écrire le journal", async () => {
    await be(chief);
    await live.query(
      "update public.availability_entries set availability_type='NIGHT' where campaign_id=$1 and user_id=$2",
      [campaign, chief],
    );
    await be(admin);
    type Line = {
      action: string;
      old_value: { availability_type: string } | null;
      new_value: { availability_type: string } | null;
    };
    const { rows } = await live.query<Line>(
      "select action, old_value, new_value from public.audit_logs where entity='availability_entry' order by occurred_at, id",
    );
    expect(rows.map(r => r.action)).toEqual(["SET", "SET"]);
    expect(rows[0].old_value).toBeNull();
    expect(rows[0].new_value?.availability_type).toBe("FULL_24H");
    expect(rows[1].old_value?.availability_type).toBe("FULL_24H");
    expect(rows[1].new_value?.availability_type).toBe("NIGHT");
    // Validation, hours, catalogue, draft and publication each leave their trace.
    const actions = await live.query<{ entity: string; action: string }>(
      "select distinct entity, action from public.audit_logs where entity <> 'availability_entry'",
    );
    expect(actions.rows).toEqual(
      expect.arrayContaining([
        { entity: "campaign_participant", action: "VALIDATE" },
        { entity: "organization", action: "HOURS" },
        { entity: "qualification", action: "CREATE" },
        { entity: "schedule_assignment", action: "ASSIGN" },
        { entity: "schedule_shift", action: "PUBLISH" },
        { entity: "staffing_requirement", action: "SET" },
      ]),
    );
    // The trail is written by the engine; no session may forge a line.
    await expect(
      live.query("insert into public.audit_logs(organization_id,entity,entity_id,action) values ($1,'x','y','z')", [
        org,
      ]),
    ).rejects.toThrow();
  });
});

describe("Enchaînement des migrations — 0003", () => {
  const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

  it("refuse 0003 sur une base qui n’a jamais reçu 0002", async () => {
    const fresh = new PGlite();
    await fresh.exec(baseAuthSchema);
    await fresh.exec(read("0001_foundation.sql"));
    await expect(fresh.exec(read("0003_client_writes.sql"))).rejects.toThrow("Apply 0002_planning.sql first");
    await fresh.close();
  }, 30000);

  it("refuse 0003 une seconde fois, sans rien laisser derrière", async () => {
    const fresh = new PGlite();
    await fresh.exec(baseAuthSchema);
    for (const m of MIGRATIONS) await fresh.exec(read(m));
    await expect(fresh.exec(read("0003_client_writes.sql"))).rejects.toThrow();
    await fresh.exec("rollback");
    // One wrapper, one audit function: the refused replay added nothing.
    const { rows } = await fresh.query<{ count: number }>(
      "select count(*)::int as count from pg_proc where proname in ('publish_shift','record_audit','can_administer')",
    );
    expect(rows[0].count).toBe(3);
    await fresh.close();
  }, 30000);
});

// 0004 replaces a SQL script with a mechanism: an administrator records who is
// expected, the agent creates their own account, and a trigger does the joining.
// The whole point is that no service key exists anywhere, so the rules have to
// hold against a real engine rather than against an application's good manners.
describe("Administration des agents ouverte par 0004", () => {
  const org = "10000000-0000-0000-0000-000000000020";
  const team = "20000000-0000-0000-0000-000000000020";
  const admin = "30000000-0000-0000-0000-000000000020";
  const manager = "30000000-0000-0000-0000-000000000021";
  const agent = "30000000-0000-0000-0000-000000000022";
  const invited = "30000000-0000-0000-0000-000000000023";
  const later = "30000000-0000-0000-0000-000000000024";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`insert into auth.users(id) values ('${admin}'), ('${manager}'), ('${agent}');
      insert into public.profiles(user_id,display_name) values ('${admin}','Administratrice'), ('${manager}','Gestionnaire'), ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre 0004');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Écho');
      insert into public.memberships values
        ('${org}','${admin}','${team}','ADMIN',true),
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true);`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("rattache un agent invité dès que son adresse est confirmée", async () => {
    await be(admin);
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,grade,matricule,invited_by)
       values ($1,$2,'nouveau@example.org','Nouvel Agent','AGENT','Sapeur','SP-42',$3)`,
      [org, team, admin],
    );
    // The account is created by the engine's own auth schema, never by the app.
    await live.exec("reset role");
    await live.query("insert into auth.users(id,email,email_confirmed_at) values ($1,'nouveau@example.org',now())", [
      invited,
    ]);
    await be(admin);
    expect(
      (await live.query("select display_name, grade, matricule from public.profiles where user_id=$1", [invited])).rows,
    ).toEqual([{ display_name: "Nouvel Agent", grade: "Sapeur", matricule: "SP-42" }]);
    expect(
      (
        await live.query("select organization_id, team_id, role, active from public.memberships where user_id=$1", [
          invited,
        ])
      ).rows,
    ).toEqual([{ organization_id: org, team_id: team, role: "AGENT", active: true }]);
    expect(
      (await live.query("select accepted_by from public.invitations where email='nouveau@example.org'")).rows,
    ).toEqual([{ accepted_by: invited }]);
  });

  it("ne donne sa place qu’à une adresse confirmée", async () => {
    await be(admin);
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,'plus-tard@example.org','Plus Tard','AGENT',$3)`,
      [org, team, admin],
    );
    await live.exec("reset role");
    await live.query("insert into auth.users(id,email) values ($1,'plus-tard@example.org')", [later]);
    expect((await live.query("select 1 from public.memberships where user_id=$1", [later])).rows).toHaveLength(0);
    await live.query("update auth.users set email_confirmed_at = now() where id=$1", [later]);
    expect((await live.query("select 1 from public.memberships where user_id=$1", [later])).rows).toHaveLength(1);
  });

  it("n’attache rien à une inscription que personne n’a invitée", async () => {
    const stranger = "30000000-0000-0000-0000-000000000025";
    await live.exec("reset role");
    await live.query("insert into auth.users(id,email,email_confirmed_at) values ($1,'inconnu@example.org',now())", [
      stranger,
    ]);
    expect((await live.query("select 1 from public.profiles where user_id=$1", [stranger])).rows).toHaveLength(0);
    expect((await live.query("select 1 from public.memberships where user_id=$1", [stranger])).rows).toHaveLength(0);
  });

  it("garde les invitations hors de portée d’un agent", async () => {
    await be(agent);
    expect((await live.query("select id from public.invitations")).rows).toHaveLength(0);
    await expect(
      live.query(
        `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
         values ($1,$2,'moi@example.org','Moi','ADMIN',$3)`,
        [org, team, agent],
      ),
    ).rejects.toThrow();
  });

  it("ne laisse personne se promouvoir, ni un gestionnaire changer un rôle", async () => {
    await be(manager);
    await expect(
      live.query("update public.memberships set role='ADMIN' where organization_id=$1 and user_id=$2", [org, manager]),
    ).rejects.toThrow("Cannot change your own role");
    await expect(
      live.query("update public.memberships set role='ADMIN' where organization_id=$1 and user_id=$2", [org, agent]),
    ).rejects.toThrow("Only an administrator");
    // A transfer is not a promotion: the same profile may still move an agent.
    await live.query("update public.memberships set active=false where organization_id=$1 and user_id=$2", [
      org,
      agent,
    ]);
    expect(
      (await live.query("select active from public.memberships where organization_id=$1 and user_id=$2", [org, agent]))
        .rows,
    ).toEqual([{ active: false }]);
    await be(admin);
    await live.query(
      "update public.memberships set role='RESPONSABLE', active=true where organization_id=$1 and user_id=$2",
      [org, agent],
    );
    expect(
      (await live.query("select role from public.memberships where organization_id=$1 and user_id=$2", [org, agent]))
        .rows,
    ).toEqual([{ role: "RESPONSABLE" }]);
  });

  it("refuse qu’un administrateur se désactive lui-même", async () => {
    await be(admin);
    await expect(
      live.query("update public.memberships set active=false where organization_id=$1 and user_id=$2", [org, admin]),
    ).rejects.toThrow("Cannot deactivate your own account");
  });

  it("journalise l’administration, l’acceptation au nom de l’agent", async () => {
    await be(admin);
    const qualification = (
      await live.query<{ id: string }>(
        "insert into public.qualifications(organization_id,name) values ($1,'SAP') returning id",
        [org],
      )
    ).rows[0].id;
    await live.query(
      "insert into public.user_qualifications(organization_id,user_id,qualification_id) values ($1,$2,$3)",
      [org, invited, qualification],
    );
    const { rows } = await live.query<{ entity: string; action: string }>(
      "select distinct entity, action from public.audit_logs where organization_id=$1",
      [org],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { entity: "invitation", action: "CREATE" },
        { entity: "invitation", action: "ACCEPT" },
        { entity: "membership", action: "JOIN" },
        { entity: "membership", action: "ROLE" },
        { entity: "membership", action: "DEACTIVATE" },
        { entity: "user_qualification", action: "GRANT" },
      ]),
    );
    // The acceptance belongs to the agent, not to whoever's session ran the insert.
    expect(
      (
        await live.query(
          "select actor_id from public.audit_logs where entity='invitation' and action='ACCEPT' and entity_id='nouveau@example.org'",
        )
      ).rows,
    ).toEqual([{ actor_id: invited }]);
  });
});

describe("Enchaînement des migrations — 0004", () => {
  const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

  it("refuse 0004 sur une base qui n’a jamais reçu 0003", async () => {
    const fresh = new PGlite();
    await fresh.exec(baseAuthSchema);
    await fresh.exec(read("0001_foundation.sql"));
    await fresh.exec(read("0002_planning.sql"));
    await expect(fresh.exec(read("0004_agent_administration.sql"))).rejects.toThrow(
      "Apply 0003_client_writes.sql first",
    );
    await fresh.close();
  }, 30000);

  it("refuse 0004 une seconde fois, sans rien laisser derrière", async () => {
    const fresh = new PGlite();
    await fresh.exec(baseAuthSchema);
    for (const m of MIGRATIONS) await fresh.exec(read(m));
    await expect(fresh.exec(read("0004_agent_administration.sql"))).rejects.toThrow();
    await fresh.exec("rollback");
    // The agent record gained three columns, once.
    const { rows } = await fresh.query<{ count: number }>(
      "select count(*)::int as count from information_schema.columns where table_name='profiles' and column_name in ('grade','matricule','phone')",
    );
    expect(rows[0].count).toBe(3);
    await fresh.close();
  }, 30000);
});
