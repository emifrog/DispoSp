import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { baseAuthSchema, freshDatabase, MIGRATIONS, provisioningScript } from "./fixtures/schema";
const db = new PGlite();
// La liste des migrations et le schéma d'authentification vivent avec les
// autres montages de test : les parcours de provisionnement s'en servent aussi,
// et deux listes finiraient par diverger.
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
  await db.exec(baseAuthSchema);
  // Applied in order, exactly as they are against the real project: the tests
  // therefore check the migration sequence, not a single hand-kept schema file.
  for (const migration of MIGRATIONS)
    await db.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  await db.exec(`insert into auth.users values ('${agentA}'), ('${agentB}'), ('${managerA}');
    insert into public.profiles values ('${agentA}', 'Agent A'), ('${agentB}', 'Agent B'), ('${managerA}', 'Responsable A');
    insert into public.organizations(id,name) values ('${orgA}','Centre A'), ('${orgB}','Centre B');
    insert into public.teams(id,organization_id,name) values ('${teamA}','${orgA}','Alpha'), ('${teamB}','${orgB}','Bravo');
    insert into public.memberships values ('${orgA}','${agentA}','${teamA}','AGENT',true), ('${orgB}','${agentB}','${teamB}','AGENT',true), ('${orgA}','${managerA}','${teamA}','GESTIONNAIRE',true);
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

  it("réserve le journal d’audit aux profils autorisés, centre par centre", async () => {
    // Simple agent de ce centre : rien, quel que soit le centre.
    await asUser(chief);
    expect((await db.query("select * from public.audit_logs")).rows).toHaveLength(0);
    // Gestionnaire d'un AUTRE centre. Il lit bien un journal — le sien — mais
    // pas une ligne de celui-ci : c'est le cloisonnement qui est testé ici, et
    // non plus l'ancien rôle RESPONSABLE, qui ne lisait aucun journal du tout.
    await asUser(managerA);
    expect((await db.query("select * from public.audit_logs where organization_id=$1", [orgC])).rows).toHaveLength(0);
    await asUser(managerC);
    expect((await db.query("select * from public.audit_logs")).rows.length).toBeGreaterThan(0);
  });
});

// The situation that produced "relation organizations already exists": a script
// meant for a fresh database replayed on one that already carries part of it.
describe("Enchaînement des migrations", () => {
  const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
  const authSchema = baseAuthSchema;

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
  const authSchema = baseAuthSchema;
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
  const authSchema = baseAuthSchema;
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
      // Les mêmes noms que ceux écrits en tête de premiere-campagne.sql : les
      // parcours ci-dessous l'exécutent tel qu'il est livré, valeurs par défaut
      // comprises, et vérifient donc aussi qu'elles se répondent d'un fichier à
      // l'autre.
      withValues(file("premiere-organisation.sql"), {
        admin_email: "chef@example.org",
        org_name: "CIS Nice Bon Voyage",
        team_name: "Bon Voyage",
      }),
    );
    return fresh;
  }

  it("refuse une organisation inconnue", async () => {
    const fresh = await provisioned();
    await expect(
      fresh.exec(withValues(file("premiere-campagne.sql"), { org_name: "Centre absent", team_name: "Bon Voyage" })),
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
      "update public.memberships set role='GESTIONNAIRE', active=true where organization_id=$1 and user_id=$2",
      [org, agent],
    );
    expect(
      (await live.query("select role from public.memberships where organization_id=$1 and user_id=$2", [org, agent]))
        .rows,
    ).toEqual([{ role: "GESTIONNAIRE" }]);
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

// Being invited to a campaign is what « opening one » means for an agent, so the
// notification rides on the same insert. Written by the engine: a session may
// mark its own as read and nothing else.
describe("Notifications ouvertes par 0005", () => {
  const org = "10000000-0000-0000-0000-000000000030";
  const team = "20000000-0000-0000-0000-000000000030";
  const manager = "30000000-0000-0000-0000-000000000030";
  const agent = "30000000-0000-0000-0000-000000000031";
  const other = "30000000-0000-0000-0000-000000000032";
  const campaign = "40000000-0000-0000-0000-000000000030";
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
    await live.exec(`insert into auth.users(id) values ('${manager}'), ('${agent}'), ('${other}');
      insert into public.profiles(user_id,display_name) values ('${manager}','Responsable'), ('${agent}','Agent'), ('${other}','Autre');
      insert into public.organizations(id,name) values ('${org}','Centre 0005');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Foxtrot');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('${org}','${other}','${team}','AGENT',true);`);
    await be(manager);
    await live.query(
      `insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
       values ($1,$2,$3,'Disponibilités de novembre 2026','2026-11-01','2026-11-30',now()-interval '1 day', timestamptz '2026-10-25 21:59:59+00')`,
      [campaign, org, team],
    );
    await live.query(
      "insert into public.campaign_participants(organization_id,campaign_id,user_id) values ($1,$2,$3)",
      [org, campaign, agent],
    );
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("prévient l’agent invité, avec la date de clôture en heure du centre", async () => {
    await be(agent);
    const { rows } = await live.query<{ kind: string; subject: string; body: string; read_at: unknown }>(
      "select kind, subject, body, read_at from public.notifications",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("CAMPAIGN_OPENED");
    expect(rows[0].subject).toBe("Campagne ouverte : Disponibilités de novembre 2026");
    // 25/10 21:59:59 UTC, c’est encore le 25 à Paris — et non le 26.
    expect(rows[0].body).toContain("25/10/2026");
    expect(rows[0].read_at).toBeNull();
  });

  it("ne montre à personne les notifications d’un autre", async () => {
    await be(other);
    expect((await live.query("select id from public.notifications")).rows).toHaveLength(0);
  });

  it("laisse marquer les siennes comme lues, sans pouvoir en écrire une", async () => {
    await be(agent);
    await live.query("update public.notifications set read_at = now()");
    expect(
      (await live.query<{ read_at: unknown }>("select read_at from public.notifications")).rows[0].read_at,
    ).not.toBeNull();
    await expect(
      live.query(
        "insert into public.notifications(organization_id,user_id,kind,subject) values ($1,$2,'CAMPAIGN_OPENED','Forgée')",
        [org, agent],
      ),
    ).rejects.toThrow();
    // Le sujet et le destinataire restent hors de portée : seul read_at est ouvert.
    await expect(live.query("update public.notifications set subject = 'Détournée'")).rejects.toThrow();
  });
});

// Sending is a separate act from being notified: the queue is readable only by
// someone who manages the centre, and only through a function narrow enough to
// return nothing to anyone else.
describe("File d’envoi ouverte par 0006", () => {
  const org = "10000000-0000-0000-0000-000000000040";
  const team = "20000000-0000-0000-0000-000000000040";
  const manager = "30000000-0000-0000-0000-000000000040";
  const agent = "30000000-0000-0000-0000-000000000041";
  const campaign = "40000000-0000-0000-0000-000000000040";
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
    await live.exec(`insert into auth.users(id,email) values ('${manager}','chef@example.org'), ('${agent}','agent@example.org');
      insert into public.profiles(user_id,display_name) values ('${manager}','Responsable'), ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre 0006');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Golf');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true);`);
    await be(manager);
    await live.query(
      `insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
       values ($1,$2,$3,'Disponibilités de novembre 2026','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '10 days')`,
      [campaign, org, team],
    );
    await live.query(
      "insert into public.campaign_participants(organization_id,campaign_id,user_id) values ($1,$2,$3)",
      [org, campaign, agent],
    );
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("recopie l’adresse depuis le schéma d’authentification, et la suit", async () => {
    await be(manager);
    expect((await live.query("select email from public.profiles where user_id=$1", [agent])).rows).toEqual([
      { email: "agent@example.org" },
    ]);
    // L’autorité reste à auth.users : un changement là-bas redescend ici.
    await live.exec("reset role");
    await live.query("update auth.users set email='nouvelle@example.org' where id=$1", [agent]);
    await be(manager);
    expect((await live.query("select email from public.profiles where user_id=$1", [agent])).rows).toEqual([
      { email: "nouvelle@example.org" },
    ]);
  });

  it("ne livre la file qu’à qui encadre le centre", async () => {
    await be(agent);
    expect((await live.query("select * from public.pending_notifications($1)", [org])).rows).toHaveLength(0);
    await be(manager);
    const { rows } = await live.query<{ email: string; kind: string; subject: string }>(
      "select email, kind, subject from public.pending_notifications($1)",
      [org],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "nouvelle@example.org", kind: "CAMPAIGN_OPENED" });
  });

  it("marque comme envoyé, une seule fois, et seulement pour son centre", async () => {
    await be(manager);
    const ids = (await live.query<{ id: string }>("select id from public.pending_notifications($1)", [org])).rows.map(
      r => r.id,
    );
    expect(
      (await live.query<{ mark_notifications_sent: number }>("select public.mark_notifications_sent($1)", [ids]))
        .rows[0].mark_notifications_sent,
    ).toBe(1);
    // Rejouer n’envoie rien de plus : la file est vide.
    expect(
      (await live.query<{ mark_notifications_sent: number }>("select public.mark_notifications_sent($1)", [ids]))
        .rows[0].mark_notifications_sent,
    ).toBe(0);
    expect((await live.query("select * from public.pending_notifications($1)", [org])).rows).toHaveLength(0);
    // Un agent ne peut pas étouffer un envoi qui ne le concerne pas.
    await live.exec("reset role");
    await live.query("update public.notifications set sent_at = null");
    await be(agent);
    expect(
      (await live.query<{ mark_notifications_sent: number }>("select public.mark_notifications_sent($1)", [ids]))
        .rows[0].mark_notifications_sent,
    ).toBe(0);
  });

  it("ne relance que ceux qui n’ont pas validé, et pas deux fois", async () => {
    await be(manager);
    expect(
      (await live.query<{ remind_campaign: number }>("select public.remind_campaign($1)", [campaign])).rows[0]
        .remind_campaign,
    ).toBe(1);
    // Le rappel en attente vaut pour toute la période : le répéter n’ajoute rien.
    expect(
      (await live.query<{ remind_campaign: number }>("select public.remind_campaign($1)", [campaign])).rows[0]
        .remind_campaign,
    ).toBe(0);
    // Une réponse validée sort l’agent de la liste des relances.
    await live.exec("reset role");
    await live.query("delete from public.notifications where kind='CAMPAIGN_REMINDER'");
    await live.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-11-01','DAY')",
      [campaign, agent],
    );
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1", [campaign]);
    await be(manager);
    expect(
      (await live.query<{ remind_campaign: number }>("select public.remind_campaign($1)", [campaign])).rows[0]
        .remind_campaign,
    ).toBe(0);
  });

  it("refuse la relance d’une campagne que l’on n’encadre pas", async () => {
    await be(agent);
    await expect(live.query("select public.remind_campaign($1)", [campaign])).rejects.toThrow("Not allowed to remind");
  });
});

// Le modèle de quelqu'un ne dit pas ce qu'il fera, mais ce qu'il fait d'habitude.
// Aucun écran de pilotage n'en a besoin, et la base le garde pour lui.
describe("Disponibilité habituelle ouverte par 0007", () => {
  const org = "10000000-0000-0000-0000-000000000050";
  const team = "20000000-0000-0000-0000-000000000050";
  const manager = "30000000-0000-0000-0000-000000000050";
  const agent = "30000000-0000-0000-0000-000000000051";
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
    await live.exec(`insert into auth.users(id) values ('${manager}'), ('${agent}');
      insert into public.profiles(user_id,display_name) values ('${manager}','Responsable'), ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre 0007');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Hotel');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true);`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("laisse un agent composer sa semaine", async () => {
    await be(agent);
    await live.query(
      `insert into public.availability_templates(organization_id,user_id,weekday,availability_type)
       values ($1,$2,1,'DAY'), ($1,$2,6,'FULL_24H')`,
      [org, agent],
    );
    expect(
      (await live.query("select weekday, availability_type from public.availability_templates order by weekday")).rows,
    ).toEqual([
      { weekday: 1, availability_type: "DAY" },
      { weekday: 6, availability_type: "FULL_24H" },
    ]);
  });

  it("refuse un jour hors semaine et un type inconnu", async () => {
    await be(agent);
    await expect(
      live.query(
        "insert into public.availability_templates(organization_id,user_id,weekday,availability_type) values ($1,$2,8,'DAY')",
        [org, agent],
      ),
    ).rejects.toThrow();
    await expect(
      live.query(
        "insert into public.availability_templates(organization_id,user_id,weekday,availability_type) values ($1,$2,2,'PEUT-ÊTRE')",
        [org, agent],
      ),
    ).rejects.toThrow();
  });

  it("garde le modèle hors de portée des autres, gestionnaire compris", async () => {
    await be(manager);
    expect((await live.query("select * from public.availability_templates")).rows).toHaveLength(0);
    // Ni lecture, ni écriture au nom d’un autre.
    await expect(
      live.query(
        "insert into public.availability_templates(organization_id,user_id,weekday,availability_type) values ($1,$2,3,'NIGHT')",
        [org, agent],
      ),
    ).rejects.toThrow();
  });

  it("n’entre dans aucune disponibilité tant que rien n’est appliqué", async () => {
    await be(agent);
    expect((await live.query("select * from public.availability_entries")).rows).toHaveLength(0);
  });
});

// Test the actual RPC under RLS, including failures after the planning was built.
describe("Création atomique d’une campagne", () => {
  const org = "10000000-0000-0000-0000-000000000060";
  const foreignOrg = "10000000-0000-0000-0000-000000000061";
  const team = "20000000-0000-0000-0000-000000000060";
  const otherTeam = "20000000-0000-0000-0000-000000000061";
  const foreignTeam = "20000000-0000-0000-0000-000000000062";
  const manager = "30000000-0000-0000-0000-000000000060";
  const agent = "30000000-0000-0000-0000-000000000061";
  const inactive = "30000000-0000-0000-0000-000000000062";
  const otherAgent = "30000000-0000-0000-0000-000000000063";
  const admin = "30000000-0000-0000-0000-000000000064";
  const foreignManager = "30000000-0000-0000-0000-000000000065";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const create = async (
    overrides: { org?: string; team?: string; name?: string; month?: string; closes?: string } = {},
  ) => {
    const { rows } = await live.query<{ id: string }>(
      "select public.create_campaign($1,$2,$3,$4::date,$5::date) as id",
      [
        overrides.org ?? org,
        overrides.team ?? team,
        overrides.name ?? "Campagne test",
        overrides.month ?? "2096-02-01",
        overrides.closes ?? "2096-01-25",
      ],
    );
    return rows[0].id;
  };
  const counts = async () => {
    await live.exec("reset role");
    return (
      await live.query(`select
      (select count(*)::int from public.availability_campaigns) as campaigns,
      (select count(*)::int from public.schedules) as schedules,
      (select count(*)::int from public.schedule_shifts) as shifts,
      (select count(*)::int from public.campaign_participants) as participants,
      (select count(*)::int from public.notifications) as notifications,
      (select count(*)::int from public.audit_logs) as audit`)
    ).rows;
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const migration of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id) values ('${manager}'), ('${agent}'), ('${inactive}'), ('${otherAgent}'), ('${admin}'), ('${foreignManager}');
      insert into public.profiles(user_id,display_name) values ('${manager}','Responsable'), ('${agent}','Agent'), ('${inactive}','Inactif'), ('${otherAgent}','Autre équipe'), ('${admin}','Administrateur'), ('${foreignManager}','Autre centre');
      insert into public.organizations(id,name,day_start,night_start) values ('${org}','Centre transaction',7,19), ('${foreignOrg}','Autre centre',8,20);
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha'), ('${otherTeam}','${org}','Bravo'), ('${foreignTeam}','${foreignOrg}','Charlie');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('${org}','${inactive}','${team}','GESTIONNAIRE',false),
        ('${org}','${otherAgent}','${otherTeam}','AGENT',true),
        ('${org}','${admin}','${otherTeam}','ADMIN',true),
        ('${foreignOrg}','${foreignManager}','${foreignTeam}','GESTIONNAIRE',true);
    `);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("crée un mois bissextile complet, avec les horaires du centre et ses seuls membres actifs", async () => {
    await be(manager);
    const id = await create({ name: "  Février 2096  " });
    expect(
      (
        await live.query(
          `select name, starts_on::text, ends_on::text, day_start, night_start,
      to_char(closes_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') as closing,
      locked from public.availability_campaigns where id=$1`,
          [id],
        )
      ).rows,
    ).toEqual([
      {
        name: "Février 2096",
        starts_on: "2096-02-01",
        ends_on: "2096-02-29",
        day_start: 7,
        night_start: 19,
        closing: "2096-01-25 22:59:59",
        locked: false,
      },
    ]);
    expect((await live.query("select team_id from public.schedules where campaign_id=$1", [id])).rows).toEqual([
      { team_id: team },
    ]);
    const shifts = await live.query<{ date: string; shift_code: string; published_revision: number }>(
      `select sh.date::text, sh.shift_code, sh.published_revision from public.schedule_shifts sh
       join public.schedules s on s.id=sh.schedule_id where s.campaign_id=$1 order by sh.date, sh.shift_code`,
      [id],
    );
    expect(shifts.rows).toHaveLength(58);
    expect(shifts.rows.slice(-2)).toEqual([
      { date: "2096-02-29", shift_code: "DAY", published_revision: 0 },
      { date: "2096-02-29", shift_code: "NIGHT", published_revision: 0 },
    ]);
    expect(
      (
        await live.query(
          "select user_id, validated_at from public.campaign_participants where campaign_id=$1 order by user_id",
          [id],
        )
      ).rows,
    ).toEqual([
      { user_id: manager, validated_at: null },
      { user_id: agent, validated_at: null },
    ]);
    await live.exec("reset role");
    expect(
      (
        await live.query(
          "select user_id from public.notifications where subject='Campagne ouverte : Février 2096' order by user_id",
        )
      ).rows,
    ).toEqual([{ user_id: manager }, { user_id: agent }]);
    expect(
      (
        await live.query(
          "select actor_id from public.audit_logs where entity='availability_campaign' and entity_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ actor_id: manager }]);
  });

  it("respecte l’heure d’été et laisse un administrateur gérer une autre équipe de son centre", async () => {
    await be(admin);
    const id = await create({ month: "2096-08-01", closes: "2096-07-25" });
    expect(
      (
        await live.query(
          "select to_char(closes_at at time zone 'UTC','HH24:MI:SS') as closing from public.availability_campaigns where id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ closing: "21:59:59" }]);
    expect(
      (
        await live.query(
          "select count(*)::int as count from public.schedule_shifts sh join public.schedules s on s.id=sh.schedule_id where s.campaign_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ count: 62 }]);
  });

  // Ce que la suppression de RESPONSABLE change, affirmé plutôt que sous-entendu :
  // un gestionnaire n'est plus tenu à son équipe, il gère tout son centre.
  it("laisse un gestionnaire créer une campagne pour une autre équipe de son centre", async () => {
    await be(manager);
    const id = await create({ team: otherTeam });
    expect((await live.query("select team_id from public.schedules where campaign_id=$1", [id])).rows).toEqual([
      { team_id: otherTeam },
    ]);
  });

  // Le cas [manager, org, otherTeam] a quitté cette liste pour le test ci-dessus.
  it.each([
    [agent, org, team],
    [inactive, org, team],
    [manager, foreignOrg, foreignTeam],
    [foreignManager, org, team],
    [admin, foreignOrg, foreignTeam],
  ])("refuse la création hors droits (%s, %s, %s)", async (user, targetOrg, targetTeam) => {
    const before = await counts();
    await be(user);
    await expect(create({ org: targetOrg, team: targetTeam })).rejects.toThrow("Not allowed to create this campaign");
    expect(await counts()).toEqual(before);
  });

  it.each([{ name: "  " }, { month: "2096-02-02" }, { closes: "2000-01-01" }, { team: foreignTeam }])(
    "refuse les paramètres invalides sans rien écrire (%j)",
    async overrides => {
      const before = await counts();
      await be(admin);
      await expect(create(overrides)).rejects.toThrow();
      expect(await counts()).toEqual(before);
    },
  );

  it("annule aussi le planning, les participants, les notifications et l’audit en cas d’échec tardif", async () => {
    const before = await counts();
    // Simulate an error after a notification has actually been inserted.
    await live.exec(`create function private.fail_test_notification() returns trigger language plpgsql as $$
      begin raise exception 'Simulated notification failure'; end; $$;
      create trigger fail_test_notification after insert on public.notifications
        for each row execute function private.fail_test_notification();`);
    try {
      await be(manager);
      await expect(create({ name: "Annulation tardive" })).rejects.toThrow("Simulated notification failure");
      expect(await counts()).toEqual(before);
    } finally {
      await live.exec(
        "reset role; drop trigger fail_test_notification on public.notifications; drop function private.fail_test_notification();",
      );
    }
    await be(manager);
    const id = await create({ name: "Reprise après échec" });
    expect((await live.query("select id from public.schedules where campaign_id=$1", [id])).rows).toHaveLength(1);
  });

  it.each([
    ["2097-02-01", 56],
    ["2096-04-01", 60],
  ])("génère exactement les deux créneaux quotidiens du mois %s", async (month, expected) => {
    await be(manager);
    const id = await create({ month });
    expect(
      (
        await live.query(
          "select count(*)::int as count from public.schedule_shifts sh join public.schedules s on s.id=sh.schedule_id where s.campaign_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ count: expected }]);
  });

  it("refuse une seconde application de la migration sans modifier la fonction ni les données", async () => {
    const before = await counts();
    await expect(
      live.exec(
        readFileSync(
          new URL("../supabase/migrations/20260918151529_atomic_campaign_creation.sql", import.meta.url),
          "utf8",
        ),
      ),
    ).rejects.toThrow("already exists");
    await live.exec("rollback");
    expect(await counts()).toEqual(before);
    await be(manager);
    expect(await create()).toEqual(expect.any(String));
  });

  it("garde les droits de l’appelant et refuse les appels anonymes ou sans identité", async () => {
    await live.exec("reset role");
    expect(
      (
        await live.query(
          `select prosecdef from pg_proc where oid='public.create_campaign(uuid,uuid,text,date,date)'::regprocedure`,
        )
      ).rows,
    ).toEqual([{ prosecdef: false }]);
    await live.exec("set role anon");
    await expect(create()).rejects.toThrow("permission denied for function create_campaign");
    await be("");
    await expect(create()).rejects.toThrow("Not allowed to create this campaign");
  });
});

// Les deux écritures de la disponibilité habituelle, ramenées chacune à une
// transaction. C’est ce que le client ne pouvait pas garantir : il effaçait la
// semaine avant de la réécrire, et appliquait un type de disponibilité à la fois.
describe("Disponibilité habituelle atomique", () => {
  const org = "10000000-0000-0000-0000-000000000060";
  const team = "20000000-0000-0000-0000-000000000060";
  const agent = "30000000-0000-0000-0000-000000000060";
  const other = "30000000-0000-0000-0000-000000000061";
  const october = "40000000-0000-0000-0000-000000000060";
  const closed = "40000000-0000-0000-0000-000000000061";
  const mondays = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
  const saturdays = ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"];
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const save = async (days: Record<string, string | null>, on = org) =>
    (
      await live.query<{ n: number }>("select public.save_availability_template($1, $2::jsonb) as n", [
        on,
        JSON.stringify(days),
      ])
    ).rows[0].n;
  const apply = async (campaign = october) =>
    (await live.query<{ n: number }>("select public.apply_availability_template($1) as n", [campaign])).rows[0].n;
  const week = async (who = agent) => {
    await live.exec("reset role");
    return (
      await live.query(
        "select weekday, availability_type from public.availability_templates where user_id=$1 order by weekday",
        [who],
      )
    ).rows;
  };
  const days = async (campaign = october) => {
    await live.exec("reset role");
    return (
      await live.query<{ date: string; availability_type: string; comment: string }>(
        "select date::text as date, availability_type, comment from public.availability_entries where campaign_id=$1 and user_id=$2 order by date",
        [campaign, agent],
      )
    ).rows;
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const migration of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    await live.exec(`insert into auth.users(id) values ('${agent}'), ('${other}');
      insert into public.profiles(user_id,display_name) values ('${agent}','Agent'), ('${other}','Autre');
      insert into public.organizations(id,name) values ('${org}','Centre modèle');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${agent}','${team}','AGENT',true), ('${org}','${other}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values
        ('${october}','${org}','${team}','Octobre','2026-10-01','2026-10-31',now()-interval '1 day',now()+interval '10 days'),
        ('${closed}','${org}','${team}','Septembre','2026-09-01','2026-09-30',now()-interval '40 days',now()-interval '10 days');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${october}','${agent}'), ('${org}','${closed}','${agent}'), ('${org}','${october}','${other}');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("remplace la semaine entière et traite un jour nul comme « rien d’habituel »", async () => {
    await be(agent);
    expect(await save({ 1: "UNAVAILABLE", 2: "DAY", 6: "FULL_24H" })).toEqual(3);
    expect(await week()).toEqual([
      { weekday: 1, availability_type: "UNAVAILABLE" },
      { weekday: 2, availability_type: "DAY" },
      { weekday: 6, availability_type: "FULL_24H" },
    ]);
    await be(agent);
    expect(await save({ 1: "UNAVAILABLE", 2: null, 6: "FULL_24H", 7: null })).toEqual(2);
    expect(await week()).toEqual([
      { weekday: 1, availability_type: "UNAVAILABLE" },
      { weekday: 6, availability_type: "FULL_24H" },
    ]);
  });

  // La régression que cette migration referme : un refus au milieu de l’écriture
  // laissait l’agent sans disponibilité habituelle, la sienne étant déjà effacée.
  it("garde la semaine précédente quand une valeur est refusée", async () => {
    await be(agent);
    await expect(save({ 1: "DAY", 8: "DAY" })).rejects.toThrow();
    expect(await week()).toEqual([
      { weekday: 1, availability_type: "UNAVAILABLE" },
      { weekday: 6, availability_type: "FULL_24H" },
    ]);
    await be(agent);
    await expect(save({ 1: "DAY", 3: "PEUT-ÊTRE" })).rejects.toThrow();
    expect(await week()).toEqual([
      { weekday: 1, availability_type: "UNAVAILABLE" },
      { weekday: 6, availability_type: "FULL_24H" },
    ]);
  });

  it("n’écrit la semaine que pour soi, et pas dans un centre dont on n’est pas membre", async () => {
    await be(other);
    expect(await save({ 4: "NIGHT" })).toEqual(1);
    expect(await week(other)).toEqual([{ weekday: 4, availability_type: "NIGHT" }]);
    expect(await week()).toHaveLength(2);
    await be(agent);
    await expect(save({ 1: "DAY" }, "10000000-0000-0000-0000-0000000000ff")).rejects.toThrow();
  });

  it("applique le modèle aux seuls jours concernés du mois", async () => {
    await be(agent);
    expect(await apply()).toEqual(9);
    expect(await days()).toEqual(
      [...mondays, ...saturdays].sort().map(date => ({
        date,
        availability_type: mondays.includes(date) ? "UNAVAILABLE" : "FULL_24H",
        comment: "",
      })),
    );
  });

  it("écrase le jour déjà renseigné, laisse les autres et garde leur commentaire", async () => {
    await be(agent);
    await live.query(
      "update public.availability_entries set availability_type='DAY' where campaign_id=$1 and date='2026-10-05'",
      [october],
    );
    await be(agent);
    await live.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type,comment) values ($1,$2,'2026-10-06','NIGHT','de garde')",
      [october, agent],
    );
    await be(agent);
    expect(await apply()).toEqual(9);
    const written = await days();
    expect(written.find(row => row.date === "2026-10-05")).toEqual({
      date: "2026-10-05",
      availability_type: "UNAVAILABLE",
      comment: "",
    });
    expect(written.find(row => row.date === "2026-10-06")).toEqual({
      date: "2026-10-06",
      availability_type: "NIGHT",
      comment: "de garde",
    });
    expect(written).toHaveLength(10);
  });

  it("invalide une réponse validée quand le modèle est réappliqué", async () => {
    await be(agent);
    await save({ 1: "DAY", 2: "DAY", 3: "DAY", 4: "DAY", 5: "DAY", 6: "FULL_24H", 7: "UNAVAILABLE" });
    await be(agent);
    expect(await apply()).toEqual(31);
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
      october,
      agent,
    ]);
    await live.exec("reset role");
    expect(
      (
        await live.query(
          "select validated_at is not null as validated from public.campaign_participants where campaign_id=$1 and user_id=$2",
          [october, agent],
        )
      ).rows,
    ).toEqual([{ validated: true }]);
    await be(agent);
    expect(await apply()).toEqual(31);
    await live.exec("reset role");
    expect(
      (
        await live.query("select validated_at from public.campaign_participants where campaign_id=$1 and user_id=$2", [
          october,
          agent,
        ])
      ).rows,
    ).toEqual([{ validated_at: null }]);
  });

  it("n’écrit aucun jour sur une campagne fermée", async () => {
    await be(agent);
    await expect(apply(closed)).rejects.toThrow("Campaign is closed");
    expect(await days(closed)).toHaveLength(0);
  });

  it("refuse un modèle vide, une campagne étrangère et un appel sans identité", async () => {
    await be(other);
    await live.query("select public.save_availability_template($1, '{}'::jsonb)", [org]);
    await be(other);
    await expect(apply()).rejects.toThrow("Availability template is empty");
    await be(other);
    await expect(apply(closed)).rejects.toThrow("Not a participant of this campaign");
    await be("");
    await expect(apply()).rejects.toThrow("Not allowed to apply a template to this campaign");
    await be("");
    await expect(save({ 1: "DAY" })).rejects.toThrow("Not allowed to write this template");
  });

  it("garde les droits de l’appelant et reste fermée à anon", async () => {
    await live.exec("reset role");
    expect(
      (
        await live.query(`select proname, prosecdef from pg_proc
          where oid in ('public.save_availability_template(uuid,jsonb)'::regprocedure,
                        'public.apply_availability_template(uuid)'::regprocedure)
          order by proname`)
      ).rows,
    ).toEqual([
      { proname: "apply_availability_template", prosecdef: false },
      { proname: "save_availability_template", prosecdef: false },
    ]);
    await live.exec("set role anon");
    await expect(apply()).rejects.toThrow("permission denied for function apply_availability_template");
    await expect(save({ 1: "DAY" })).rejects.toThrow("permission denied for function save_availability_template");
  });
});

// Un script qui efface ne se relit pas : il s'exécute. Celui-ci part d'un centre
// complet et vérifie ce qui disparaît, ce qui reste, et ce qu'il refuse de faire.
describe("Retrait d’un compte", () => {
  const org = "10000000-0000-0000-0000-000000000070";
  const team = "20000000-0000-0000-0000-000000000070";
  const chief = "30000000-0000-0000-0000-000000000070";
  const second = "30000000-0000-0000-0000-000000000071";
  const agent = "30000000-0000-0000-0000-000000000072";
  const campaign = "40000000-0000-0000-0000-000000000070";
  const script = readFileSync(new URL("../supabase/provisioning/retirer-un-compte.sql", import.meta.url), "utf8");
  const remove = (email: string) => live.exec(script.replace("'agent.qui.part@exemple.fr'", `'${email}'`));
  let live: PGlite;

  beforeEach(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const migration of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id,email) values
        ('${chief}','chef@example.org'), ('${second}','second@example.org'), ('${agent}','agent@example.org');
      insert into public.profiles(user_id,display_name) values
        ('${chief}','Chef'), ('${second}','Second'), ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre retrait');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${chief}','${team}','GESTIONNAIRE',true),
        ('${org}','${second}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Octobre','2026-10-01','2026-10-31',now()-interval '1 day',now()+interval '9 days');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${org}','${campaign}','${agent}');
      insert into public.availability_entries(campaign_id,user_id,date,availability_type)
        values ('${campaign}','${agent}','2026-10-05','DAY');
      insert into public.availability_templates(organization_id,user_id,weekday,availability_type)
        values ('${org}','${agent}',1,'DAY');
      insert into public.notifications(organization_id,user_id,kind,subject)
        values ('${org}','${agent}','CAMPAIGN_OPENED','Campagne ouverte');
      insert into public.invitations(organization_id,email,display_name,team_id,role,invited_by)
        values ('${org}','futur@example.org','Futur agent','${team}','AGENT','${agent}');
    `);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  const counts = async (who: string) =>
    (
      await live.query<{ total: number }>(
        `select (
           (select count(*) from public.availability_entries where user_id=$1)
         + (select count(*) from public.campaign_participants where user_id=$1)
         + (select count(*) from public.availability_templates where user_id=$1)
         + (select count(*) from public.user_qualifications where user_id=$1)
         + (select count(*) from public.notifications where user_id=$1)
         + (select count(*) from public.invitations where invited_by=$1)
         + (select count(*) from public.memberships where user_id=$1)
         + (select count(*) from public.profiles where user_id=$1))::int as total`,
        [who],
      )
    ).rows[0].total;

  it("efface les données du compte, dans l’ordre des dépendances", async () => {
    expect(await counts(agent)).toBeGreaterThan(5);
    await remove("agent@example.org");
    expect(await counts(agent)).toBe(0);
    // Le centre et ce qui ne lui appartient pas restent intacts.
    expect((await live.query("select count(*)::int as n from public.organizations")).rows).toEqual([{ n: 1 }]);
    expect((await live.query("select count(*)::int as n from public.memberships")).rows).toEqual([{ n: 2 }]);
  });

  it("garde le journal d’audit et se contente d’anonymiser l’auteur", async () => {
    await live.exec(
      `insert into public.audit_logs(organization_id,actor_id,entity,entity_id,action)
       values ('${org}','${agent}','availability_entry','${campaign}','UPDATE')`,
    );
    const before = (await live.query<{ n: number }>("select count(*)::int as n from public.audit_logs")).rows[0].n;
    await remove("agent@example.org");
    // Aucune ligne ne disparaît — le retrait en ajoute même, puisque effacer est
    // aussi une action du centre.
    expect(
      (await live.query<{ n: number }>("select count(*)::int as n from public.audit_logs")).rows[0].n,
    ).toBeGreaterThanOrEqual(before);
    // Le script ne touche pas à auth.users : l'identité se supprime à la main,
    // depuis le tableau de bord. C'est ce geste-là qui anonymise le journal,
    // par le « on delete set null » de la colonne.
    expect(
      (await live.query("select count(*)::int as n from public.audit_logs where actor_id = $1", [agent])).rows,
    ).toEqual([{ n: 1 }]);
    await live.query("delete from auth.users where id = $1", [agent]);
    expect(
      (await live.query("select count(*)::int as n from public.audit_logs where actor_id is not null")).rows,
    ).toEqual([{ n: 0 }]);
  });

  // La porte se refermerait de l'intérieur : sans administrateur, personne ne
  // peut plus rattacher un agent, et le schéma interdit de se rattacher soi-même.
  it("refuse de laisser le centre sans administrateur actif", async () => {
    await remove("second@example.org");
    await expect(remove("chef@example.org")).rejects.toThrow("sans administrateur actif");
    expect(await counts(chief)).toBeGreaterThan(0);
  });

  it("refuse une adresse inconnue, et ne touche à rien", async () => {
    await expect(remove("personne@example.org")).rejects.toThrow("Aucun compte pour");
    expect(await counts(agent)).toBeGreaterThan(5);
  });
});

// Désistements : la demande et sa réponse, rien d'autre. La table ne touche pas
// au planning — c'est publish_schedule_shift() qui le fait, et il refuserait un
// créneau dont l'effectif n'est plus couvert.
describe("Désistements sur une garde publiée", () => {
  const org = "10000000-0000-0000-0000-000000000070";
  const team = "20000000-0000-0000-0000-000000000070";
  const manager = "30000000-0000-0000-0000-000000000070";
  const held = "30000000-0000-0000-0000-000000000071";
  const other = "30000000-0000-0000-0000-000000000072";
  const foreign = "30000000-0000-0000-0000-000000000073";
  const foreignOrg = "10000000-0000-0000-0000-000000000071";
  const foreignTeam = "20000000-0000-0000-0000-000000000071";
  const campaign = "40000000-0000-0000-0000-000000000070";
  const schedule = "60000000-0000-0000-0000-000000000070";
  const shift = "70000000-0000-0000-0000-000000000070";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  // Lu hors rôle, délibérément : c'est l'état réel de la table qu'on veut, pas
  // ce que la session en cours a le droit d'en voir. Sous un rôle, « aucune
  // ligne » confondrait « rien n'a été écrit » et « je n'y ai pas accès ».
  const open = async () => {
    await live.exec("reset role");
    return (await live.query<{ id: string }>("select id from public.shift_withdrawals where state='PENDING'")).rows;
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id) values ('${manager}'), ('${held}'), ('${other}'), ('${foreign}');
      insert into public.profiles(user_id,display_name) values
        ('${manager}','Chef'), ('${held}','Titulaire'), ('${other}','Autre'), ('${foreign}','Etranger');
      insert into public.organizations(id,name) values ('${org}','Centre 70'), ('${foreignOrg}','Centre 71');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha'), ('${foreignTeam}','${foreignOrg}','Beta');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${held}','${team}','AGENT',true),
        ('${org}','${other}','${team}','AGENT',true),
        ('${foreignOrg}','${foreign}','${foreignTeam}','GESTIONNAIRE',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${campaign}','${held}'), ('${org}','${campaign}','${other}');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        values ('${shift}','${org}','${schedule}','2026-11-01','DAY');
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount)
        values ('${org}','${campaign}','2026-11-01','DAY',1);`);
    // Les deux agents se déclarent disponibles et valident : sans cela la
    // publication refuse, et il n'y aurait aucune garde dont se désister.
    for (const agent of [held, other]) {
      await be(agent);
      await live.query(
        "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-11-01','FULL_24H')",
        [campaign, agent],
      );
      await live.query(
        "update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2",
        [campaign, agent],
      );
    }
    await be(manager);
    await live.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [org, shift, held, manager],
    );
    await live.query("select private.publish_schedule_shift($1)", [shift]);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("refuse le désistement de qui ne tient pas la garde", async () => {
    await be(other);
    await expect(
      live.query("insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id) values ($1,$2,$3)", [
        org,
        shift,
        other,
      ]),
    ).rejects.toThrow();
    expect(await open()).toHaveLength(0);
  });

  it("refuse le désistement au nom d’un autre", async () => {
    await be(other);
    await expect(
      live.query("insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id) values ($1,$2,$3)", [
        org,
        shift,
        held,
      ]),
    ).rejects.toThrow();
    expect(await open()).toHaveLength(0);
  });

  it("accepte celui du titulaire, et prévient ceux qui encadrent", async () => {
    await be(held);
    await live.query(
      "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,'Convocation')",
      [org, shift, held],
    );
    expect(await open()).toHaveLength(1);
    await live.exec("reset role");
    expect(
      (await live.query("select user_id from public.notifications where kind='WITHDRAWAL_REQUESTED'")).rows,
    ).toEqual([{ user_id: manager }]);
  });

  it("n’en accepte pas deux en même temps pour la même garde", async () => {
    await be(held);
    await expect(
      live.query("insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id) values ($1,$2,$3)", [
        org,
        shift,
        held,
      ]),
    ).rejects.toThrow();
  });

  it("ne montre rien à un autre agent, ni à un autre centre", async () => {
    await be(other);
    expect((await live.query("select id from public.shift_withdrawals")).rows).toHaveLength(0);
    await be(foreign);
    expect((await live.query("select id from public.shift_withdrawals")).rows).toHaveLength(0);
  });

  it("interdit à l’agent de trancher sa propre demande", async () => {
    const [{ id }] = await open();
    await be(held);
    // La ligne est bien la sienne, donc le « using » de sa policy la laisse
    // passer ; c'est le « with check » qui refuse l'état d'arrivée. Le refus est
    // donc explicite, pas un silence : la demande n'est pas filtrée, elle est
    // rejetée.
    await expect(live.query("update public.shift_withdrawals set state='ACCEPTED' where id=$1", [id])).rejects.toThrow(
      "row-level security",
    );
    await live.exec("reset role");
    expect((await live.query("select state from public.shift_withdrawals where id=$1", [id])).rows).toEqual([
      { state: "PENDING" },
    ]);
  });

  it("laisse le gestionnaire trancher, estampille l’auteur et prévient l’agent", async () => {
    const [{ id }] = await open();
    await be(manager);
    await live.query("update public.shift_withdrawals set state='ACCEPTED' where id=$1", [id]);
    await live.exec("reset role");
    expect(
      (
        await live.query("select state, decided_by is not null as signed from public.shift_withdrawals where id=$1", [
          id,
        ])
      ).rows,
    ).toEqual([{ state: "ACCEPTED", signed: true }]);
    expect((await live.query("select user_id from public.notifications where kind='WITHDRAWAL_DECIDED'")).rows).toEqual(
      [{ user_id: held }],
    );
  });

  it("laisse le planning publié intact : accepter n’est pas réaffecter", async () => {
    await live.exec("reset role");
    const rows = (
      await live.query(
        `select a.user_id from public.schedule_assignments a
         join public.schedule_shifts s on s.id = a.schedule_shift_id and a.revision = s.published_revision
         where s.id = $1`,
        [shift],
      )
    ).rows;
    expect(rows).toEqual([{ user_id: held }]);
  });

  it("garde une trace au journal d’audit", async () => {
    await live.exec("reset role");
    const rows = (
      await live.query("select action from public.audit_logs where entity='shift_withdrawal' order by occurred_at")
    ).rows;
    expect(rows).toEqual([{ action: "CREATE" }, { action: "ACCEPTED" }]);
  });
});

// Correctifs de l'audit du 19 septembre : l'escalade par invitation et
// l'écriture partielle d'un besoin. Les deux avaient été reproduits avant
// correction ; ces tests les rejouent pour qu'ils ne reviennent pas.
describe("Correctifs de droits et de besoins", () => {
  const org = "10000000-0000-0000-0000-000000000080";
  const team = "20000000-0000-0000-0000-000000000080";
  const admin = "30000000-0000-0000-0000-000000000080";
  const manager = "30000000-0000-0000-0000-000000000081";
  const plain = "30000000-0000-0000-0000-000000000082";
  const campaign = "40000000-0000-0000-0000-000000000080";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const minima = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ name: string; minimum: number }>(
        `select q.name, rq.minimum from public.staffing_requirement_qualifications rq
         join public.qualifications q on q.id = rq.qualification_id order by q.name`,
      )
    ).rows;
  };
  const headcount = async () => {
    await live.exec("reset role");
    return (await live.query<{ headcount: number }>("select headcount from public.staffing_requirements")).rows;
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id) values ('${admin}'), ('${manager}'), ('${plain}');
      insert into public.profiles(user_id,display_name) values
        ('${admin}','Administrateur'), ('${manager}','Gestionnaire'), ('${plain}','Agent simple');
      insert into public.organizations(id,name) values ('${org}','Centre 80');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${admin}','${team}','ADMIN',true),
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${plain}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '1 day');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("refuse à un gestionnaire d’inviter un administrateur", async () => {
    await be(manager);
    await expect(
      live.query(
        `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
         values ($1,$2,'escalade@example.org','Escalade','ADMIN',$3)`,
        [org, team, manager],
      ),
    ).rejects.toThrow("row-level security");
  });

  it("lui laisse inviter un agent ou un gestionnaire", async () => {
    await be(manager);
    for (const [email, role] of [
      ["agent@example.org", "AGENT"],
      ["collegue@example.org", "GESTIONNAIRE"],
    ]) {
      await live.query(
        `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
         values ($1,$2,$3,'Invité',$4,$5)`,
        [org, team, email, role, manager],
      );
    }
    await live.exec("reset role");
    expect((await live.query("select id from public.invitations")).rows).toHaveLength(2);
  });

  it("l’empêche aussi de relever le rôle d’une invitation déjà posée", async () => {
    await be(manager);
    // Le contournement en deux temps : inviter un agent, puis le passer ADMIN.
    await expect(
      live.query("update public.invitations set role='ADMIN' where email='agent@example.org'"),
    ).rejects.toThrow("row-level security");
  });

  it("laisse un administrateur inviter un administrateur", async () => {
    await be(admin);
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,'second.admin@example.org','Second Admin','ADMIN',$3)`,
      [org, team, admin],
    );
    await live.exec("reset role");
    expect(
      (await live.query("select role from public.invitations where email='second.admin@example.org'")).rows,
    ).toEqual([{ role: "ADMIN" }]);
  });

  it("écrit un besoin en entier, effectif et minima d’un bloc", async () => {
    await be(manager);
    await live.query("select public.set_staffing_requirement($1,$2,$3,$4,$5)", [
      campaign,
      "2026-11-01",
      "DAY",
      4,
      JSON.stringify({ SAP: 2, Chef: 1 }),
    ]);
    expect(await headcount()).toEqual([{ headcount: 4 }]);
    expect(await minima()).toEqual([
      { name: "Chef", minimum: 1 },
      { name: "SAP", minimum: 2 },
    ]);
  });

  it("n’efface rien quand le nouveau minimum est refusé", async () => {
    await be(manager);
    // Un minimum supérieur à l’effectif : le déclencheur requirement_minimum
    // refuse. Avant le correctif, l’effacement préalable avait déjà eu lieu et
    // le créneau se retrouvait sans aucune exigence.
    await expect(
      live.query("select public.set_staffing_requirement($1,$2,$3,$4,$5)", [
        campaign,
        "2026-11-01",
        "DAY",
        4,
        JSON.stringify({ SAP: 9 }),
      ]),
    ).rejects.toThrow();
    expect(await minima()).toEqual([
      { name: "Chef", minimum: 1 },
      { name: "SAP", minimum: 2 },
    ]);
    expect(await headcount()).toEqual([{ headcount: 4 }]);
  });

  it("remplace l’ensemble des minima quand l’écriture aboutit", async () => {
    await be(manager);
    await live.query("select public.set_staffing_requirement($1,$2,$3,$4,$5)", [
      campaign,
      "2026-11-01",
      "DAY",
      5,
      JSON.stringify({ SAP: 3 }),
    ]);
    expect(await minima()).toEqual([{ name: "SAP", minimum: 3 }]);
    expect(await headcount()).toEqual([{ headcount: 5 }]);
  });

  it("refuse le besoin à un simple agent, sans rien changer", async () => {
    await be(plain);
    await expect(
      live.query("select public.set_staffing_requirement($1,$2,$3,$4,$5)", [
        campaign,
        "2026-11-01",
        "DAY",
        1,
        JSON.stringify({}),
      ]),
    ).rejects.toThrow();
    expect(await headcount()).toEqual([{ headcount: 5 }]);
  });
});

// L'invitation rattache dans les deux sens : le compte arrive après elle, ou
// il existait déjà. Le second cas laissait l'invitation en attente pour
// toujours, sans recours depuis l'application.
describe("Rattachement par invitation, compte neuf ou existant", () => {
  const org = "10000000-0000-0000-0000-000000000090";
  const team = "20000000-0000-0000-0000-000000000090";
  const manager = "30000000-0000-0000-0000-000000000090";
  const fresh = "30000000-0000-0000-0000-000000000091";
  const already = "30000000-0000-0000-0000-000000000092";
  const unconfirmed = "30000000-0000-0000-0000-000000000093";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const membership = async (user: string) => {
    await live.exec("reset role");
    return (await live.query<{ role: string }>("select role from public.memberships where user_id=$1", [user])).rows;
  };
  const pending = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ email: string }>(
        "select email from public.invitations where accepted_at is null order by email",
      )
    ).rows;
  };
  const invite = async (email: string) => {
    await be(manager);
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,grade,invited_by)
       values ($1,$2,$3,'Invité','AGENT','Sergent',$4)`,
      [org, team, email, manager],
    );
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id) values ('${manager}');
      insert into public.profiles(user_id,display_name) values ('${manager}','Gestionnaire');
      insert into public.organizations(id,name) values ('${org}','Centre 90');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${manager}','${team}','GESTIONNAIRE',true);
      -- Un compte confirmé qui existe avant son invitation.
      insert into auth.users(id,email,email_confirmed_at) values ('${already}','deja@example.org',now());
      -- Un compte créé mais jamais confirmé : il ne doit pas être rattaché.
      insert into auth.users(id,email) values ('${unconfirmed}','jamais@example.org');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("rattache le compte neuf à la confirmation de son adresse", async () => {
    await invite("neuf@example.org");
    expect(await membership(fresh)).toHaveLength(0);
    await live.exec("reset role");
    await live.query("insert into auth.users(id,email,email_confirmed_at) values ($1,'neuf@example.org',now())", [
      fresh,
    ]);
    expect(await membership(fresh)).toEqual([{ role: "AGENT" }]);
  });

  it("rattache immédiatement celui dont le compte existe déjà", async () => {
    await invite("deja@example.org");
    // Aucune confirmation à attendre : elle a eu lieu il y a longtemps.
    expect(await membership(already)).toEqual([{ role: "AGENT" }]);
    expect((await pending()).map(r => r.email)).not.toContain("deja@example.org");
  });

  it("recopie la fiche de l’invitation dans le profil, quel que soit le chemin", async () => {
    await live.exec("reset role");
    expect(
      (await live.query<{ grade: string }>("select grade from public.profiles where user_id=$1", [already])).rows,
    ).toEqual([{ grade: "Sergent" }]);
  });

  it("laisse en attente une invitation dont le compte n’est pas confirmé", async () => {
    await invite("jamais@example.org");
    expect(await membership(unconfirmed)).toHaveLength(0);
    expect((await pending()).map(r => r.email)).toContain("jamais@example.org");
  });
});

// Ce que la publication doit refuser : un agent sorti de l'effectif, et un
// agent à qui l'on vient de répondre qu'il n'était plus attendu. Les deux
// passaient, et le second contredisait la notification déjà envoyée.
describe("Éligibilité à la publication", () => {
  const org = "10000000-0000-0000-0000-0000000000a0";
  const team = "20000000-0000-0000-0000-0000000000a0";
  const manager = "30000000-0000-0000-0000-0000000000a0";
  const alice = "30000000-0000-0000-0000-0000000000a1";
  const bob = "30000000-0000-0000-0000-0000000000a2";
  const campaign = "40000000-0000-0000-0000-0000000000a0";
  const schedule = "60000000-0000-0000-0000-0000000000a0";
  const shift = "70000000-0000-0000-0000-0000000000a0";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const publish = () => live.query("select private.publish_schedule_shift($1)", [shift]);
  const revision = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ published_revision: number }>(
        "select published_revision from public.schedule_shifts where id=$1",
        [shift],
      )
    ).rows[0].published_revision;
  };
  const assign = async (user: string) => {
    await be(manager);
    await live.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [org, shift, user, manager],
    );
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id) values ('${manager}'), ('${alice}'), ('${bob}');
      insert into public.profiles(user_id,display_name) values
        ('${manager}','Chef'), ('${alice}','Alice'), ('${bob}','Bob');
      insert into public.organizations(id,name) values ('${org}','Centre A0');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${alice}','${team}','AGENT',true),
        ('${org}','${bob}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${campaign}','${alice}'), ('${org}','${campaign}','${bob}');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        values ('${shift}','${org}','${schedule}','2026-11-01','DAY');
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount)
        values ('${org}','${campaign}','2026-11-01','DAY',1);`);
    for (const agent of [alice, bob]) {
      await be(agent);
      await live.query(
        "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-11-01','FULL_24H')",
        [campaign, agent],
      );
      await live.query(
        "update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2",
        [campaign, agent],
      );
    }
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("publie une garde en règle", async () => {
    await assign(alice);
    await be(manager);
    await publish();
    expect(await revision()).toBe(1);
  });

  it("refuse de republier un agent dont le désistement a été accepté", async () => {
    await be(alice);
    await live.query(
      "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,'Convocation')",
      [org, shift, alice],
    );
    await be(manager);
    await live.query("update public.shift_withdrawals set state='ACCEPTED' where user_id=$1", [alice]);
    // Le brouillon n'a pas bougé : c'est exactement l'oubli que le garde vise.
    await expect(publish()).rejects.toThrow("Accepted withdrawal");
    expect(await revision()).toBe(1);
  });

  it("publie de nouveau si l’encadrement réaffecte après avoir tranché", async () => {
    // Retirer puis remettre : la réaffectation porte une date plus récente que
    // la décision, et vaut décision neuve. Sans quoi un désistement d'octobre
    // interdirait cette garde à cet agent pour toujours.
    await be(manager);
    await live.query("delete from public.schedule_assignments where schedule_shift_id=$1 and revision=0", [shift]);
    await assign(alice);
    await be(manager);
    await publish();
    expect(await revision()).toBe(2);
  });

  it("refuse de publier un agent sorti de l’effectif", async () => {
    await live.exec("reset role");
    await live.query("delete from public.schedule_assignments where schedule_shift_id=$1 and revision=0", [shift]);
    await live.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [org, shift, bob, manager],
    );
    // Bob garde sa disponibilité validée : c'est bien son rattachement qui
    // change, pas sa réponse. Le défaut tenait à ce que rien ne le regardait.
    await live.query("update public.memberships set active=false where user_id=$1", [bob]);
    await be(manager);
    await expect(publish()).rejects.toThrow("Inactive members");
    expect(await revision()).toBe(2);
  });

  it("le nomme, pour qu’on sache lequel retirer", async () => {
    await be(manager);
    await expect(publish()).rejects.toThrow("Bob");
  });
});

describe("Notifications poussées (Web Push)", () => {
  const org = "10000000-0000-0000-0000-0000000000b0";
  const other = "10000000-0000-0000-0000-0000000000b1";
  const team = "20000000-0000-0000-0000-0000000000b0";
  const otherTeam = "20000000-0000-0000-0000-0000000000b1";
  const alice = "30000000-0000-0000-0000-0000000000b0";
  const bob = "30000000-0000-0000-0000-0000000000b1";
  const outsider = "30000000-0000-0000-0000-0000000000b2";
  // Ce qu'un navigateur rend vraiment : une adresse de remise chez un service
  // connu, et deux clés au format fixe que les contraintes de la table vérifient.
  const phone = "https://fcm.googleapis.com/fcm/send/appareil-alice";
  const p256dh = "B".repeat(87);
  const auth = "A".repeat(22);
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const asServer = async () => {
    await live.exec("reset role");
    await live.exec("set role service_role");
  };
  const register = (endpoint = phone) =>
    live.query("select public.register_push_subscription($1,$2,$3)", [endpoint, p256dh, auth]);
  const notify = async (user: string) => {
    await live.exec("reset role");
    await live.query(
      "insert into public.notifications(organization_id,user_id,kind,subject) values ($1,$2,'CAMPAIGN_OPENED','Campagne ouverte')",
      [org, user],
    );
  };
  const deliveries = async () => {
    await live.exec("reset role");
    return (await live.query<{ status: string }>("select status from public.push_deliveries")).rows;
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id) values ('${alice}'), ('${bob}'), ('${outsider}');
      insert into public.profiles(user_id,display_name) values
        ('${alice}','Alice'), ('${bob}','Bob'), ('${outsider}','Étranger');
      insert into public.organizations(id,name) values ('${org}','Centre B0'), ('${other}','Centre B1');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha'), ('${otherTeam}','${other}','Bravo');
      insert into public.memberships values
        ('${org}','${alice}','${team}','AGENT',true),
        ('${org}','${bob}','${team}','AGENT',true),
        ('${other}','${outsider}','${otherTeam}','AGENT',true);`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("attache l’appareil au compte connecté et à son centre", async () => {
    await be(alice);
    await register();
    await live.exec("reset role");
    expect(
      (await live.query("select organization_id, user_id from public.push_subscriptions where endpoint=$1", [phone]))
        .rows,
    ).toEqual([{ organization_id: org, user_id: alice }]);
  });

  it("refuse une adresse de remise inconnue au même titre que l’application", async () => {
    await be(alice);
    // La table refuse ce que `validPushEndpoint` refuse déjà côté serveur : sans
    // cette contrainte, une adresse arbitraire ferait de l'expéditeur un relais.
    await expect(register("https://exemple.test/collecte")).rejects.toThrow();
  });

  it("ne montre à personne les appareils d’un autre", async () => {
    await be(bob);
    expect((await live.query("select id from public.push_subscriptions")).rows).toEqual([]);
    await be(alice);
    expect((await live.query("select endpoint from public.push_subscriptions")).rows).toEqual([{ endpoint: phone }]);
  });

  it("refuse d’inscrire un appareil au nom d’un autre", async () => {
    await be(bob);
    await expect(
      live.query(
        "insert into public.push_subscriptions(organization_id,user_id,endpoint,p256dh,auth) values ($1,$2,'https://fcm.googleapis.com/fcm/send/vole',$3,$4)",
        [org, alice, p256dh, auth],
      ),
    ).rejects.toThrow();
  });

  it("écrit un envoi par appareil dès qu’une notification est écrite", async () => {
    await notify(alice);
    expect(await deliveries()).toEqual([{ status: "pending" }]);
    // Bob n'a pas d'appareil : sa notification n'attend rien et n'encombre rien.
    await notify(bob);
    expect(await deliveries()).toEqual([{ status: "pending" }]);
  });

  it("garde la file hors de portée d’une session d’agent", async () => {
    await be(alice);
    await expect(live.query("select * from public.claim_push_deliveries()")).rejects.toThrow();
    const nowhere = "00000000-0000-0000-0000-000000000000";
    await expect(live.query("select public.finish_push_delivery($1,$1,201)", [nowhere])).rejects.toThrow();
  });

  it("réserve l’envoi pour le serveur, puis l’estampille", async () => {
    await asServer();
    const claimed = await live.query<{ id: string; lease: string; endpoint: string; kind: string }>(
      "select id, lease, endpoint, kind from public.claim_push_deliveries()",
    );
    expect(claimed.rows).toHaveLength(1);
    expect(claimed.rows[0].endpoint).toBe(phone);
    expect(claimed.rows[0].kind).toBe("CAMPAIGN_OPENED");
    // Réservé : un second passage simultané ne le reprendrait pas.
    expect(await deliveries()).toEqual([{ status: "sending" }]);
    await asServer();
    await live.query("select public.finish_push_delivery($1,$2,201)", [claimed.rows[0].id, claimed.rows[0].lease]);
    expect(await deliveries()).toEqual([{ status: "sent" }]);
  });

  it("efface l’appareil que le service de remise ne connaît plus", async () => {
    await notify(alice);
    await asServer();
    const claimed = await live.query<{ id: string; lease: string }>(
      "select id, lease from public.claim_push_deliveries()",
    );
    expect(claimed.rows).toHaveLength(1);
    await live.query("select public.finish_push_delivery($1,$2,410)", [claimed.rows[0].id, claimed.rows[0].lease]);
    await live.exec("reset role");
    // L'abonnement disparu emporte ses envois : le garder ferait échouer chaque
    // passage suivant, indéfiniment.
    expect((await live.query("select id from public.push_subscriptions")).rows).toEqual([]);
    expect(await deliveries()).toEqual([]);
  });

  it("reprend l’appareil qui change de main", async () => {
    await be(alice);
    await register();
    // Le même téléphone, le compte suivant : le navigateur rend la même adresse
    // de remise, et l'abonnement d'Alice ne doit pas survivre à son départ.
    await be(bob);
    await register();
    await live.exec("reset role");
    expect((await live.query("select user_id from public.push_subscriptions")).rows).toEqual([{ user_id: bob }]);
  });

  it("refuse l’inscription d’un compte rattaché à aucun centre actif", async () => {
    await live.exec("reset role");
    await live.query("update public.memberships set active=false where user_id=$1", [outsider]);
    await be(outsider);
    await expect(register("https://web.push.apple.com/appareil-etranger")).rejects.toThrow("aucun centre actif");
  });
});

describe("Correctifs du 22 septembre — réactivation, dernier administrateur, dévalidation", () => {
  const org = "10000000-0000-0000-0000-0000000000c0";
  const team = "20000000-0000-0000-0000-0000000000c0";
  const admin = "30000000-0000-0000-0000-0000000000c0";
  const second = "30000000-0000-0000-0000-0000000000c1";
  const manager = "30000000-0000-0000-0000-0000000000c2";
  const agent = "30000000-0000-0000-0000-0000000000c3";
  const elsewhere = "30000000-0000-0000-0000-0000000000c9";
  const campaign = "40000000-0000-0000-0000-0000000000c0";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const auditCount = async () =>
    Number((await live.query<{ n: string }>("select count(*)::text n from public.audit_logs")).rows[0].n);

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`insert into auth.users(id) values ('${admin}'), ('${second}'), ('${manager}'), ('${agent}'), ('${elsewhere}');
      insert into public.profiles(user_id,display_name) values ('${admin}','Administratrice'), ('${second}','Second Admin'), ('${manager}','Gestionnaire'), ('${agent}','Agent'), ('${elsewhere}','Ailleurs');
      insert into public.organizations(id,name) values ('${org}','Centre 22'), ('10000000-0000-0000-0000-0000000000c9','Centre voisin');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Golf'), ('20000000-0000-0000-0000-0000000000c9','10000000-0000-0000-0000-0000000000c9','Hotel');
      insert into public.memberships values
        ('${org}','${admin}','${team}','ADMIN',true),
        ('${org}','${second}','${team}','ADMIN',true),
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('10000000-0000-0000-0000-0000000000c9','${elsewhere}','20000000-0000-0000-0000-0000000000c9','AGENT',false);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Octobre','2026-10-01','2026-10-01',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${org}','${campaign}','${agent}');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  // B2 — la fiche d'un membre désactivé reste lisible et modifiable par
  // l'encadrement, sans quoi « Réactiver » échouait avant d'atteindre le
  // rattachement, et l'inactif s'affichait sous le nom « Agent ».
  it("laisse l’encadrement lire et modifier la fiche d’un membre désactivé, puis le réactiver", async () => {
    await be(manager);
    await live.query("update public.memberships set active=false where organization_id=$1 and user_id=$2", [
      org,
      agent,
    ]);
    expect((await live.query("select display_name from public.profiles where user_id=$1", [agent])).rows).toEqual([
      { display_name: "Agent" },
    ]);
    // L'ordre de writeMember : le rattachement d'abord, la fiche ensuite.
    const back = await live.query(
      "update public.memberships set active=true where organization_id=$1 and user_id=$2 returning active",
      [org, agent],
    );
    expect(back.rows).toEqual([{ active: true }]);
    const renamed = await live.query(
      "update public.profiles set display_name='Agent Revenu' where user_id=$1 returning user_id",
      [agent],
    );
    expect(renamed.rows).toEqual([{ user_id: agent }]);
  });

  it("ne laisse pas l’encadrement atteindre la fiche d’un membre d’un autre centre, actif ou non", async () => {
    await be(admin);
    expect((await live.query("select display_name from public.profiles where user_id=$1", [elsewhere])).rows).toEqual(
      [],
    );
    const touched = await live.query("update public.profiles set display_name='X' where user_id=$1 returning user_id", [
      elsewhere,
    ]);
    expect(touched.rows).toEqual([]);
  });

  // B5 — un gestionnaire pouvait désactiver le dernier administrateur et
  // verrouiller le centre : plus personne ne changeait un rôle ni n'invitait
  // un administrateur.
  it("refuse à un gestionnaire de désactiver un administrateur", async () => {
    await be(manager);
    await expect(
      live.query("update public.memberships set active=false where organization_id=$1 and user_id=$2", [org, admin]),
    ).rejects.toThrow("Only an administrator can deactivate an administrator");
    // Le déplacer d'équipe reste un geste de gestionnaire.
    const moved = await live.query(
      "update public.memberships set team_id=$3 where organization_id=$1 and user_id=$2 returning team_id",
      [org, admin, team],
    );
    expect(moved.rows).toEqual([{ team_id: team }]);
  });

  it("laisse un administrateur en désactiver un autre, jamais le dernier", async () => {
    await be(admin);
    const off = await live.query(
      "update public.memberships set active=false where organization_id=$1 and user_id=$2 returning active",
      [org, second],
    );
    expect(off.rows).toEqual([{ active: false }]);
    // Le second est inactif : l'administratrice est désormais la dernière, et
    // personne — pas même une session sans identité — ne peut la retirer.
    await be(null);
    await expect(
      live.query("update public.memberships set active=false where organization_id=$1 and user_id=$2", [org, admin]),
    ).rejects.toThrow(/last administrator|Only an administrator/);
    await be(admin);
    await live.query("update public.memberships set active=true where organization_id=$1 and user_id=$2", [
      org,
      second,
    ]);
  });

  // B6 — retirer sa validation obéit à la même fenêtre que la donner, et
  // laisse une trace ; la dévalidation qui découle d'une saisie, elle, reste
  // silencieuse dans le journal — la saisie y est déjà.
  it("laisse l’agent retirer sa validation tant que la campagne est ouverte, et le journalise", async () => {
    await be(agent);
    await live.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')",
      [campaign, agent],
    );
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
      campaign,
      agent,
    ]);
    await be(null);
    const before = await auditCount();
    await be(agent);
    await live.query("update public.campaign_participants set validated_at=null where campaign_id=$1 and user_id=$2", [
      campaign,
      agent,
    ]);
    await be(null);
    expect(await auditCount()).toBe(before + 1);
    expect((await live.query("select action, actor_id from public.audit_logs order by id desc limit 1")).rows).toEqual([
      { action: "UNVALIDATE", actor_id: agent },
    ]);
  });

  it("ne journalise pas deux fois la dévalidation qui découle d’une saisie", async () => {
    await be(agent);
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
      campaign,
      agent,
    ]);
    await be(null);
    const before = await auditCount();
    await be(agent);
    await live.query("update public.availability_entries set availability_type='NIGHT' where campaign_id=$1", [
      campaign,
    ]);
    await be(null);
    expect(
      (await live.query("select validated_at from public.campaign_participants where campaign_id=$1", [campaign])).rows,
    ).toEqual([{ validated_at: null }]);
    // Une seule ligne : la saisie. Pas d'UNVALIDATE.
    expect(await auditCount()).toBe(before + 1);
    expect((await live.query("select action from public.audit_logs order by id desc limit 1")).rows).toEqual([
      { action: "SET" },
    ]);
  });

  it("refuse de retirer une validation après la clôture", async () => {
    await be(agent);
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
      campaign,
      agent,
    ]);
    await be(manager);
    await live.query("update public.availability_campaigns set locked=true where id=$1", [campaign]);
    await be(agent);
    await expect(
      live.query("update public.campaign_participants set validated_at=null where campaign_id=$1 and user_id=$2", [
        campaign,
        agent,
      ]),
    ).rejects.toThrow("Campaign is closed");
    await be(null);
    const kept = await live.query(
      "select validated_at is not null as kept from public.campaign_participants where campaign_id=$1",
      [campaign],
    );
    expect(kept.rows).toEqual([{ kept: true }]);
  });
});

// Correctifs C1 et C2 de l'analyse du 22 septembre : ce qu'une invitation fait
// d'un compte qui existe déjà, et ce que le retrait d'un compte doit pouvoir
// défaire — désistements, gardes affectées par un gestionnaire, invitation
// acceptée, appareil abonné, puis la suppression du compte lui-même.
describe("Invitation d’un compte existant — un seul centre actif", () => {
  const orgA = "10000000-0000-0000-0000-0000000000d0";
  const orgB = "10000000-0000-0000-0000-0000000000d1";
  const teamA = "20000000-0000-0000-0000-0000000000d0";
  const teamB = "20000000-0000-0000-0000-0000000000d1";
  const managerA = "30000000-0000-0000-0000-0000000000d0";
  const memberB = "30000000-0000-0000-0000-0000000000d1";
  const dormant = "30000000-0000-0000-0000-0000000000d2";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const invite = (email: string, role = "AGENT") =>
    live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,$3,'Invité',$4,$5)`,
      [orgA, teamA, email, role, managerA],
    );

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${managerA}','chef@a.test',now()), ('${memberB}','membre@b.test',now()), ('${dormant}','ancien@a.test',now());
      insert into public.profiles(user_id,display_name) values ('${managerA}','Chef'), ('${memberB}','Membre B'), ('${dormant}','Ancien');
      insert into public.organizations(id,name) values ('${orgA}','Centre A'), ('${orgB}','Centre B');
      insert into public.teams(id,organization_id,name) values ('${teamA}','${orgA}','Alpha'), ('${teamB}','${orgB}','Bravo');
      insert into public.memberships values
        ('${orgA}','${managerA}','${teamA}','GESTIONNAIRE',true),
        ('${orgB}','${memberB}','${teamB}','AGENT',true),
        ('${orgA}','${dormant}','${teamA}','AGENT',false);`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("refuse d’inviter une adresse encore active dans un autre centre", async () => {
    await be(managerA);
    await expect(invite("membre@b.test")).rejects.toThrow("Account already belongs to another organisation");
    await be(null);
    // Rien n'a bougé : ni rattachement en A, ni fiche lisible par A.
    expect(
      (await live.query("select organization_id from public.memberships where user_id=$1", [memberB])).rows,
    ).toEqual([{ organization_id: orgB }]);
    expect((await live.query("select id from public.invitations where email='membre@b.test'")).rows).toEqual([]);
  });

  it("réactive un membre désactivé du même centre au lieu de ne rien changer", async () => {
    await be(managerA);
    await invite("ancien@a.test");
    await be(null);
    expect(
      (await live.query("select active, team_id from public.memberships where user_id=$1", [dormant])).rows,
    ).toEqual([{ active: true, team_id: teamA }]);
    expect((await live.query("select accepted_by from public.invitations where email='ancien@a.test'")).rows).toEqual([
      { accepted_by: dormant },
    ]);
  });

  it("interdit deux rattachements actifs pour un même compte, même par l’éditeur SQL", async () => {
    await be(null);
    await expect(
      live.query("insert into public.memberships values ($1,$2,$3,'AGENT',true)", [orgA, memberB, teamA]),
    ).rejects.toThrow("memberships_one_active_per_user");
  });
});

describe("Retrait d’un compte — désistements, gardes affectées, invitation acceptée, appareil", () => {
  const org = "10000000-0000-0000-0000-0000000000e0";
  const team = "20000000-0000-0000-0000-0000000000e0";
  const admin = "30000000-0000-0000-0000-0000000000e0";
  const manager = "30000000-0000-0000-0000-0000000000e1";
  const agent = "30000000-0000-0000-0000-0000000000e2";
  const other = "30000000-0000-0000-0000-0000000000e3";
  const campaign = "40000000-0000-0000-0000-0000000000e0";
  const schedule = "60000000-0000-0000-0000-0000000000e0";
  const shift = "70000000-0000-0000-0000-0000000000e0";
  const script = readFileSync(new URL("../supabase/provisioning/retirer-un-compte.sql", import.meta.url), "utf8");
  const remove = (email: string) => live.exec(script.replace("'agent.qui.part@exemple.fr'", `'${email}'`));
  let live: PGlite;
  const count = async (sql: string, params: unknown[] = []) =>
    Number((await live.query<{ n: number }>(`select count(*)::int as n ${sql}`, params)).rows[0].n);

  beforeEach(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const migration of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${admin}','admin@example.org',now()), ('${manager}','chef@example.org',now()),
        ('${agent}','agent@example.org',now()), ('${other}','autre@example.org',now());
      insert into public.profiles(user_id,display_name) values
        ('${admin}','Admin'), ('${manager}','Chef'), ('${agent}','Agent'), ('${other}','Autre');
      insert into public.organizations(id,name) values ('${org}','Centre retrait 2');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${admin}','${team}','ADMIN',true),
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('${org}','${other}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Octobre','2026-10-01','2026-10-01',now()-interval '1 day',now()+interval '9 days');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code,published_revision,published_at)
        values ('${shift}','${org}','${schedule}','2026-10-01','DAY',1,now());
      -- Le gestionnaire a affecté l'agent ET un autre agent, et publié.
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by) values
        ('${org}','${shift}','${agent}',1,'CONFIRMED','${manager}'),
        ('${org}','${shift}','${other}',1,'CONFIRMED','${manager}');
      -- L'agent s'est désisté, le gestionnaire a tranché.
      insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason,state,decided_at,decided_by)
        values ('${org}','${shift}','${agent}','Empêché','REFUSED',now(),'${manager}');
      -- L'agent est arrivé par invitation, et son téléphone est abonné.
      insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by,accepted_at,accepted_by)
        values ('${org}','${team}','agent@example.org','Agent','AGENT','${manager}',now(),'${agent}');
      insert into public.push_subscriptions(organization_id,user_id,endpoint,p256dh,auth)
        values ('${org}','${agent}','https://fcm.googleapis.com/fcm/send/retrait','${"B".repeat(87)}','${"A".repeat(22)}');
      insert into public.notifications(organization_id,user_id,kind,subject)
        values ('${org}','${agent}','SCHEDULE_PUBLISHED','Publié');`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("retire un agent qui s’est désisté et dont le téléphone est abonné, puis laisse supprimer son compte", async () => {
    await remove("agent@example.org");
    expect(await count("from public.shift_withdrawals where user_id=$1", [agent])).toBe(0);
    expect(await count("from public.push_subscriptions where user_id=$1", [agent])).toBe(0);
    expect(await count("from public.push_deliveries")).toBe(0);
    expect(await count("from public.memberships where user_id=$1", [agent])).toBe(0);
    // L'invitation qui l'a fait entrer est partie avec lui : le compte se
    // supprime, et l'adresse peut être réinvitée.
    expect(await count("from public.invitations where accepted_by=$1", [agent])).toBe(0);
    await live.query("delete from auth.users where id=$1", [agent]);
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [manager]);
    await live.exec("set role authenticated");
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,'agent@example.org','Agent de retour','AGENT',$3)`,
      [org, team, manager],
    );
    await live.exec("reset role");
    expect(await count("from public.invitations where email='agent@example.org' and accepted_at is null")).toBe(1);
  });

  it("retire un gestionnaire sans effacer les gardes des autres : ses gestes passent au relais", async () => {
    await remove("chef@example.org");
    expect(await count("from public.memberships where user_id=$1", [manager])).toBe(0);
    // La garde publiée de l'autre agent est toujours là, affectée au nom de
    // l'administrateur restant ; la décision de désistement aussi.
    expect(
      (await live.query("select user_id, assigned_by from public.schedule_assignments order by user_id")).rows,
    ).toEqual([
      { user_id: agent, assigned_by: admin },
      { user_id: other, assigned_by: admin },
    ]);
    expect((await live.query("select decided_by from public.shift_withdrawals")).rows).toEqual([{ decided_by: admin }]);
    expect((await live.query("select invited_by from public.invitations")).rows).toEqual([{ invited_by: admin }]);
    await live.query("delete from auth.users where id=$1", [manager]);
  });

  it("refuse une invitation en double tant que la première attend, pas au-delà", async () => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [manager]);
    await live.exec("set role authenticated");
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,'nouveau@example.org','Nouveau','AGENT',$3)`,
      [org, team, manager],
    );
    await expect(
      live.query(
        `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
         values ($1,$2,'nouveau@example.org','Nouveau','AGENT',$3)`,
        [org, team, manager],
      ),
    ).rejects.toThrow("invitations_pending_email_key");
  });
});

// La file d'emails, sur le modèle de la file poussée : réservée sous verrou par
// le serveur, avec bail et tentatives, hors de portée d'une session.
describe("File d’emails réservée par le serveur", () => {
  const org = "10000000-0000-0000-0000-0000000000f0";
  const team = "20000000-0000-0000-0000-0000000000f0";
  const manager = "30000000-0000-0000-0000-0000000000f0";
  const agent = "30000000-0000-0000-0000-0000000000f1";
  const mute = "30000000-0000-0000-0000-0000000000f2";
  let live: PGlite;
  const be = async (id: string | null, role: "authenticated" | "service_role" = "authenticated") => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await live.exec(`set role ${role}`);
  };
  const claim = async (batch = 50) => {
    await be(null, "service_role");
    return (
      await live.query<{ id: string; lease: string; email: string; kind: string }>(
        "select id, lease, email, kind from public.claim_email_deliveries($1)",
        [batch],
      )
    ).rows;
  };
  const statuses = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ email_status: string; email_attempts: number }>(
        "select email_status, email_attempts from public.notifications order by created_at, user_id",
      )
    ).rows;
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id,email) values ('${manager}','chef@example.org'), ('${agent}','agent@example.org'), ('${mute}', null);
      insert into public.profiles(user_id,display_name) values ('${manager}','Chef'), ('${agent}','Agent'), ('${mute}','Sans adresse');
      insert into public.organizations(id,name) values ('${org}','Centre file');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('${org}','${mute}','${team}','AGENT',true);
      insert into public.notifications(organization_id,user_id,kind,subject) values
        ('${org}','${agent}','CAMPAIGN_OPENED','Ouverte'),
        ('${org}','${mute}','CAMPAIGN_OPENED','Ouverte');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("n’est réservable que par le serveur", async () => {
    await be(manager);
    await expect(live.query("select * from public.claim_email_deliveries(10)")).rejects.toThrow(/permission denied/);
    await be(agent);
    await expect(
      live.query("select public.finish_email_delivery(gen_random_uuid(), gen_random_uuid(), 200)"),
    ).rejects.toThrow(/permission denied/);
  });

  it("réserve avec un bail, écarte ce qui n’a pas d’adresse, et ne rend pas deux fois la même ligne", async () => {
    const first = await claim();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ email: "agent@example.org", kind: "CAMPAIGN_OPENED" });
    expect(first[0].lease).toBeTruthy();
    // Le second passage ne voit rien : la ligne est en cours d'envoi, sous bail.
    expect(await claim()).toHaveLength(0);
    expect(await statuses()).toEqual([
      { email_status: "sending", email_attempts: 1 },
      { email_status: "skipped", email_attempts: 0 },
    ]);
    // Une session d'encadrement ne voit plus la ligne en cours d'envoi non plus.
    await be(manager);
    expect((await live.query("select id from public.pending_notifications($1)", [org])).rows).toHaveLength(0);
  });

  it("marque envoyé sur 2xx, reprend sur 5xx, abandonne sur 4xx", async () => {
    await live.exec("reset role");
    await live.query(
      "update public.notifications set email_status='pending', email_available_at=now(), email_attempts=0",
    );
    let [job] = await claim();
    await be(null, "service_role");
    await live.query("select public.finish_email_delivery($1,$2,503)", [job.id, job.lease]);
    expect((await statuses())[0]).toEqual({ email_status: "pending", email_attempts: 1 });
    // Le délai a été posé : rien n'est réservable tout de suite.
    expect(await claim()).toHaveLength(0);
    await live.exec("reset role");
    await live.query("update public.notifications set email_available_at=now()");
    [job] = await claim();
    await be(null, "service_role");
    // Un mauvais jeton ne finit rien.
    await live.query("select public.finish_email_delivery($1,gen_random_uuid(),200)", [job.id]);
    expect((await statuses())[0]).toEqual({ email_status: "sending", email_attempts: 2 });
    await be(null, "service_role");
    await live.query("select public.finish_email_delivery($1,$2,200)", [job.id, job.lease]);
    await live.exec("reset role");
    expect(
      (
        await live.query(
          "select email_status, sent_at is not null as sent from public.notifications where user_id=$1",
          [agent],
        )
      ).rows,
    ).toEqual([{ email_status: "sent", sent: true }]);
    // Un refus définitif du service d'envoi n'est pas réessayé.
    await live.query(
      "insert into public.notifications(organization_id,user_id,kind,subject) values ($1,$2,'CAMPAIGN_REMINDER','Rappel')",
      [org, agent],
    );
    [job] = await claim();
    await be(null, "service_role");
    await live.query("select public.finish_email_delivery($1,$2,422)", [job.id, job.lease]);
    expect((await statuses()).map(s => s.email_status)).toEqual(["sent", "skipped", "failed"]);
  });
});

describe("Première campagne — les horaires viennent de l’organisation", () => {
  it("reprend les horaires réglés depuis l’application, pas ceux des créneaux types", async () => {
    const fresh = await freshDatabase();
    const org = "10000000-0000-0000-0000-0000000000f9";
    const team = "20000000-0000-0000-0000-0000000000f9";
    const chief = "30000000-0000-0000-0000-0000000000f9";
    await fresh.exec(`
      insert into auth.users(id,email,email_confirmed_at) values ('${chief}','chef@example.org',now());
      insert into public.profiles(user_id,display_name) values ('${chief}','Chef');
      insert into public.organizations(id,name,day_start,night_start) values ('${org}','CIS Nice Bon Voyage',7,19);
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Bon Voyage');
      insert into public.memberships values ('${org}','${chief}','${team}','ADMIN',true);
      -- Les créneaux types disent encore 8 h et 20 h : personne ne les met à jour.
      insert into public.shift_types(organization_id,code,starts_at_hour,duration_hours)
        values ('${org}','DAY',8,12), ('${org}','NIGHT',20,12);`);
    await fresh.exec(provisioningScript("premiere-campagne.sql"));
    expect((await fresh.query("select day_start, night_start from public.availability_campaigns")).rows).toEqual([
      { day_start: 7, night_start: 19 },
    ]);
    await fresh.close();
  }, 30000);
});

// Point 4 de l'audit de déployabilité : la fiche d'un agent s'écrit d'un bloc.
describe("Fiche d’agent atomique", () => {
  const org = "10000000-0000-0000-0000-0000000000e0";
  const other = "10000000-0000-0000-0000-0000000000e9";
  const golf = "20000000-0000-0000-0000-0000000000e0";
  const hotel = "20000000-0000-0000-0000-0000000000e1";
  const away = "20000000-0000-0000-0000-0000000000e9";
  const manager = "30000000-0000-0000-0000-0000000000e0";
  const agent = "30000000-0000-0000-0000-0000000000e1";
  const stranger = "30000000-0000-0000-0000-0000000000e9";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const save = (member: string, team: string, name: string, qualifications: string[], role = "AGENT") =>
    live.query("select public.save_member($1,$2,$3,$4,true,$5,'Sergent',null,'M-42',null,$6)", [
      org,
      member,
      team,
      role,
      name,
      qualifications,
    ]);
  const fiche = async () => {
    await live.exec("reset role");
    const row = (
      await live.query<{ display_name: string; team_id: string; qualifications: string[] }>(
        `select p.display_name, m.team_id,
                coalesce(array(select q.name from public.user_qualifications uq
                                 join public.qualifications q on q.id = uq.qualification_id
                                where uq.user_id = $1 order by q.name), '{}') as qualifications
           from public.profiles p join public.memberships m on m.user_id = p.user_id
          where p.user_id = $1`,
        [agent],
      )
    ).rows[0];
    return row;
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`insert into auth.users(id) values ('${manager}'), ('${agent}'), ('${stranger}');
      insert into public.profiles(user_id,display_name) values ('${manager}','Gestionnaire'), ('${agent}','Agent'), ('${stranger}','Ailleurs');
      insert into public.organizations(id,name) values ('${org}','Centre 23'), ('${other}','Centre voisin');
      insert into public.teams(id,organization_id,name) values ('${golf}','${org}','Golf'), ('${hotel}','${org}','Hotel'), ('${away}','${other}','India');
      insert into public.memberships values
        ('${org}','${manager}','${golf}','GESTIONNAIRE',true),
        ('${org}','${agent}','${golf}','AGENT',true),
        ('${other}','${stranger}','${away}','AGENT',true);
      insert into public.qualifications(organization_id,name) values ('${org}','INC1'), ('${org}','SAP1');
      insert into public.user_qualifications(organization_id,user_id,qualification_id)
        select '${org}','${agent}',id from public.qualifications where organization_id='${org}' and name='INC1';`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("écrit l’équipe, le profil et l’écart de qualifications en un appel", async () => {
    await be(manager);
    // INC1 retirée, SAP1 reprise du catalogue, COD1 créée.
    await save(agent, hotel, "Agent Renommé", ["SAP1", "COD1", "SAP1", ""]);
    expect(await fiche()).toEqual({ display_name: "Agent Renommé", team_id: hotel, qualifications: ["COD1", "SAP1"] });
    await live.exec("reset role");
    expect((await live.query("select grade, matricule from public.profiles where user_id=$1", [agent])).rows).toEqual([
      { grade: "Sergent", matricule: "M-42" },
    ]);
  });

  it("n’écrit rien quand le dernier pas est refusé", async () => {
    const before = await fiche();
    await be(manager);
    // Le nom de qualification dépasse soixante caractères : refus à la
    // création du catalogue, après le rattachement et le profil.
    await expect(save(agent, golf, "Moitié Écrite", ["SAP1", "X".repeat(61)])).rejects.toThrow();
    expect(await fiche()).toEqual(before);
  });

  it("refuse, sans rien écrire, un rôle qu’un gestionnaire ne peut pas donner", async () => {
    const before = await fiche();
    await be(manager);
    await expect(save(agent, golf, "Promu", [], "ADMIN")).rejects.toThrow("Only an administrator can change a role");
    expect(await fiche()).toEqual(before);
  });

  it("refuse la fiche d’un membre d’un autre centre, et d’un agent qui n’encadre pas", async () => {
    await be(manager);
    await expect(save(stranger, golf, "Capturé", [])).rejects.toThrow("Not allowed to edit this member");
    await be(agent);
    await expect(save(manager, golf, "Usurpé", [])).rejects.toThrow("Not allowed to edit this member");
  });
});
