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
    // Un agent dans l'équipe : depuis la décision C6, l'administrateur que crée
    // premiere-organisation.sql ne prend pas de garde, et n'est donc pas inscrit.
    await fresh.exec(`
      insert into auth.users(id,email,email_confirmed_at) values (gen_random_uuid(), 'agent@example.org', now());
      insert into public.profiles(user_id,display_name) select id, 'Agent' from auth.users where email='agent@example.org';
      insert into public.memberships(organization_id,user_id,team_id,role,active)
        select t.organization_id, u.id, t.id, 'AGENT', true
          from public.teams t, auth.users u where t.name = 'Bon Voyage' and u.email = 'agent@example.org';`);
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

  it("ouvre une campagne cohérente, invite les agents de l’équipe et prépare les créneaux", async () => {
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

    // L'agent, et lui seul : l'administrateur ne prend pas de garde.
    expect(
      (
        await fresh.query(
          "select u.email from public.campaign_participants p join auth.users u on u.id = p.user_id order by u.email",
        )
      ).rows,
    ).toEqual([{ email: "agent@example.org" }]);
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
    const me = await fresh.query<{ id: string }>("select id from auth.users where email='agent@example.org'");
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

  // Depuis 20260925180000, la file de 0006 n'est plus joignable par une
  // session : l'application passe par claim_email_deliveries(), réservée au
  // serveur (voir « File d’emails réservée par le serveur »). Un gestionnaire
  // y lisait les avis en attente de son centre, et pouvait marquer la file
  // envoyée — les emails ne partaient plus.
  it("ne livre plus la file à une session, pas même d’encadrement", async () => {
    await live.exec("reset role");
    const ids = (
      await live.query<{ id: string }>("select id from public.notifications where organization_id=$1", [org])
    ).rows.map(r => r.id);
    expect(ids).toHaveLength(1);
    for (const who of [agent, manager]) {
      await be(who);
      await expect(live.query("select * from public.pending_notifications($1)", [org])).rejects.toThrow(
        /permission denied/,
      );
      await expect(live.query("select public.mark_notifications_sent($1)", [ids])).rejects.toThrow(/permission denied/);
    }
    await live.exec("reset role");
    expect(
      (await live.query("select email_status, sent_at from public.notifications where organization_id=$1", [org])).rows,
    ).toEqual([{ email_status: "pending", sent_at: null }]);
  });

  it("ne relance que ceux qui n’ont pas validé, et pas deux fois", async () => {
    await be(manager);
    expect(
      (await live.query<{ remind_campaign: number }>("select public.remind_campaign($1)", [campaign])).rows[0]
        .remind_campaign,
    ).toBe(1);
    // Depuis 20260923140000, le répéter dans les douze heures est refusé
    // (voir « Limites d’envoi »).
    await expect(live.query("select public.remind_campaign($1)", [campaign])).rejects.toThrow(
      "Campaign reminded too recently",
    );
    // Une réponse validée sort l’agent de la liste des relances.
    await live.exec("reset role");
    await live.query("delete from public.notifications where kind='CAMPAIGN_REMINDER'");
    await live.query("delete from private.campaign_reminders");
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

  // Ses seuls agents actifs : depuis la décision C6 (16 octobre), l'encadrement
  // ne prend pas de garde, et n'est donc ni inscrit ni prévenu de l'ouverture.
  it("crée un mois bissextile complet, avec les horaires du centre et ses seuls agents actifs", async () => {
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
    ).toEqual([{ user_id: agent, validated_at: null }]);
    await live.exec("reset role");
    expect(
      (
        await live.query(
          "select user_id from public.notifications where subject='Campagne ouverte : Février 2096' order by user_id",
        )
      ).rows,
    ).toEqual([{ user_id: agent }]);
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
      // Un mois à lui : depuis 20260924090000, une équipe n'a qu'une campagne
      // par mois, et le mois par défaut est déjà pris par les tests précédents.
      await expect(create({ name: "Annulation tardive", month: "2097-05-01", closes: "2097-04-25" })).rejects.toThrow(
        "Simulated notification failure",
      );
      expect(await counts()).toEqual(before);
    } finally {
      await live.exec(
        "reset role; drop trigger fail_test_notification on public.notifications; drop function private.fail_test_notification();",
      );
    }
    await be(manager);
    const id = await create({ name: "Reprise après échec", month: "2097-05-01", closes: "2097-04-25" });
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
    expect(await create({ month: "2097-06-01", closes: "2097-05-25" })).toEqual(expect.any(String));
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
      (
        await live.query("select validated_at from public.campaign_participants where campaign_id=$1 and user_id=$2", [
          campaign,
          agent,
        ])
      ).rows,
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
    // L'agent seul : l'administrateur réactivé plus haut est désormais inscrit
    // lui aussi à la campagne ouverte de son équipe (B1 du 25 septembre).
    const kept = await live.query(
      "select validated_at is not null as kept from public.campaign_participants where campaign_id=$1 and user_id=$2",
      [campaign, agent],
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

  // Analyse du 25 septembre : réattribuer decided_by déclenchait l'audit des
  // désistements, qui inscrivait une seconde « décision » REFUSED, sans auteur,
  // datée du retrait — une décision que personne n'a prise ce jour-là.
  it("passe les décisions au relais sans inscrire au journal une décision que personne n’a prise", async () => {
    const decisions = () => count("from public.audit_logs where entity='shift_withdrawal'");
    const before = await decisions();
    await remove("chef@example.org");
    expect((await live.query("select decided_by from public.shift_withdrawals")).rows).toEqual([{ decided_by: admin }]);
    expect(await decisions()).toBe(before);
    // Le déclencheur est rétabli : une vraie décision s'inscrit toujours.
    expect((await live.query("select tgenabled from pg_trigger where tgname = 'audit_withdrawals'")).rows).toEqual([
      { tgenabled: "O" },
    ]);
    await live.exec("update public.shift_withdrawals set state='PENDING', decided_by=null, decided_at=null");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    await live.exec("set role authenticated");
    await live.exec("update public.shift_withdrawals set state='ACCEPTED'");
    await live.exec("reset role");
    expect(
      (await live.query("select actor_id from public.audit_logs where entity='shift_withdrawal' and action='ACCEPTED'"))
        .rows,
    ).toEqual([{ actor_id: admin }]);
  });

  // Analyse du 25 septembre : une invitation en attente vers la même adresse,
  // dans un autre centre, survivait au retrait avec nom, téléphone et matricule.
  it("efface aussi les invitations en attente vers son adresse, dans tous les centres", async () => {
    const elsewhere = "10000000-0000-0000-0000-0000000000e9";
    const yankee = "20000000-0000-0000-0000-0000000000e9";
    const chiefY = "30000000-0000-0000-0000-0000000000e9";
    await live.exec(`
      insert into public.organizations(id,name) values ('${elsewhere}','Centre Y');
      insert into public.teams(id,organization_id,name) values ('${yankee}','${elsewhere}','Yankee');
      insert into auth.users(id,email,email_confirmed_at) values ('${chiefY}','chef.y@example.org',now());
      insert into public.profiles(user_id,display_name) values ('${chiefY}','Chef Y');
      insert into public.memberships values ('${elsewhere}','${chiefY}','${yankee}','GESTIONNAIRE',true);
      -- Posée avant que l'agent confirme son adresse ici : accept_invitation_now
      -- la refuserait aujourd'hui, pas une invitation déjà là.
      alter table public.invitations disable trigger accept_invitation_now;
      insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by,phone,matricule)
        values ('${elsewhere}','${yankee}','agent@example.org','Agent','AGENT','${chiefY}','0611111111','Y-1'),
               ('${elsewhere}','${yankee}','autre.personne@example.org','Autre','AGENT','${chiefY}',null,null);
      alter table public.invitations enable trigger accept_invitation_now;`);
    await remove("agent@example.org");
    expect(await count("from public.invitations where email='agent@example.org'")).toBe(0);
    // Ni dans les invitations, ni dans la ligne que leur effacement inscrit au journal.
    expect(
      await count(
        `from public.audit_logs where old_value::text like '%0611111111%' or old_value::text like '%Y-1%'
           or new_value::text like '%0611111111%' or entity_id='agent@example.org'`,
      ),
    ).toBe(0);
    // L'invitation d'une autre adresse, dans le même centre, reste.
    expect(
      (await live.query("select email from public.invitations where organization_id=$1", [elsewhere])).rows,
    ).toEqual([{ email: "autre.personne@example.org" }]);
  });

  // RGPD, 23 septembre : le déclencheur de saisie refuse toute suppression sur
  // une campagne close — y compris celle du script. Un agent qui avait répondu
  // à une campagne passée, soit presque tous, ne pouvait pas être retiré.
  it("retire un agent qui a répondu à une campagne aujourd’hui close", async () => {
    await live.exec(`
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${org}','${campaign}','${agent}');
      insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ('${campaign}','${agent}','2026-10-01','DAY');
      update public.availability_campaigns set locked = true where id = '${campaign}';`);
    await remove("agent@example.org");
    expect(await count("from public.availability_entries where user_id=$1", [agent])).toBe(0);
    expect(await count("from public.memberships where user_id=$1", [agent])).toBe(0);
    // Le déclencheur est rétabli : la campagne close refuse toujours une saisie.
    await expect(
      live.query(
        "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')",
        [campaign, other],
      ),
    ).rejects.toThrow("Campaign is closed");
  });

  // Le journal garde les actions d'un agent retiré, mais pas ses coordonnées :
  // chaque modification de sa fiche y avait recopié nom, téléphone, matricule.
  it("efface du journal les coordonnées de l’agent retiré, pas les actions", async () => {
    await live.exec(`update public.profiles set phone = '0600000000', matricule = 'M-77' where user_id = '${agent}';
      insert into private.invitation_sends(invitation_id,organization_id,email) values (null,'${org}','agent@example.org');`);
    const before = await count("from public.audit_logs");
    expect(
      await count(
        "from public.audit_logs where old_value::text like '%0600000000%' or new_value::text like '%0600000000%'",
      ),
    ).toBeGreaterThan(0);
    await remove("agent@example.org");
    expect(
      await count(
        "from public.audit_logs where old_value::text like '%0600000000%' or new_value::text like '%0600000000%'",
      ),
    ).toBe(0);
    expect(
      await count("from public.audit_logs where old_value::text like '%M-77%' or new_value::text like '%M-77%'"),
    ).toBe(0);
    expect(await count("from public.audit_logs where entity_id = 'agent@example.org'")).toBe(0);
    // Le journal des envois d'invitation garde l'adresse : il part aussi.
    expect(await count("from private.invitation_sends where email = 'agent@example.org'")).toBe(0);
    // Rien n'a disparu du journal : les lignes restent, anonymisées.
    expect(await count("from public.audit_logs")).toBeGreaterThanOrEqual(before);
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
    // Une session d'encadrement ne voit pas la file du tout : depuis
    // 20260925180000, l'ancienne fonction de 0006 lui est fermée.
    await be(manager);
    await expect(live.query("select id from public.pending_notifications($1)", [org])).rejects.toThrow(
      /permission denied/,
    );
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

// Point 6 de l'audit de déployabilité : ce qui envoie des emails a des limites.
describe("Limites d’envoi", () => {
  const org = "10000000-0000-0000-0000-0000000000f0";
  const other = "10000000-0000-0000-0000-0000000000f9";
  const team = "20000000-0000-0000-0000-0000000000f0";
  const away = "20000000-0000-0000-0000-0000000000f9";
  const manager = "30000000-0000-0000-0000-0000000000f0";
  const agent = "30000000-0000-0000-0000-0000000000f1";
  const outsider = "30000000-0000-0000-0000-0000000000f9";
  const invitation = "50000000-0000-0000-0000-0000000000f0";
  const campaign = "40000000-0000-0000-0000-0000000000f0";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const reserve = async (id = invitation) =>
    (await live.query<{ email: string | null }>("select public.reserve_invitation_send($1) as email", [id])).rows[0]
      .email;
  const remind = async () =>
    (await live.query<{ n: number }>("select public.remind_campaign($1) as n", [campaign])).rows[0].n;
  // Fait vieillir les journaux, comme si le temps avait passé.
  const age = async (sql: string) => {
    await live.exec("reset role");
    await live.exec(sql);
  };

  beforeAll(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`insert into auth.users(id) values ('${manager}'), ('${agent}'), ('${outsider}');
      insert into public.profiles(user_id,display_name) values ('${manager}','Gestionnaire'), ('${agent}','Agent'), ('${outsider}','Voisin');
      insert into public.organizations(id,name) values ('${org}','Centre F'), ('${other}','Centre voisin');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Golf'), ('${away}','${other}','India');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('${other}','${outsider}','${away}','GESTIONNAIRE',true);
      insert into public.invitations(id,organization_id,team_id,email,display_name,role,invited_by)
        values ('${invitation}','${org}','${team}','recrue@example.org','Recrue','AGENT','${manager}');
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Décembre','2026-12-01','2026-12-01',now()-interval '1 day',now()+interval '10 days');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${org}','${campaign}','${agent}');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("espace les envois d’une invitation d’un quart d’heure, et en permet cinq", async () => {
    await be(manager);
    expect(await reserve()).toBe("recrue@example.org");
    await expect(reserve()).rejects.toThrow("Invitation sent too recently");
    for (let sent = 1; sent < 5; sent++) {
      await age("update private.invitation_sends set sent_at = sent_at - interval '20 minutes'");
      await be(manager);
      expect(await reserve()).toBe("recrue@example.org");
    }
    await age("update private.invitation_sends set sent_at = sent_at - interval '20 minutes'");
    await be(manager);
    await expect(reserve()).rejects.toThrow("Invitation send limit reached");
    // Réserver n'a rien modifié de l'invitation : l'historique n'en dit rien.
    await live.exec("reset role");
    expect(
      (await live.query("select action from public.audit_logs where entity='invitation' and action <> 'CREATE'")).rows,
    ).toEqual([]);
  });

  // B1 de l'analyse du 23 septembre : un envoi qui n'est pas parti ne compte pas.
  it("rend la réservation d’un envoi qui a échoué, et seul le serveur le peut", async () => {
    const fresh = "50000000-0000-0000-0000-0000000000f2";
    await live.exec("reset role");
    await live.query(
      `insert into public.invitations(id,organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,$3,'rendue@example.org','Rendue','AGENT',$4)`,
      [fresh, org, team, manager],
    );
    await be(manager);
    expect(await reserve(fresh)).toBe("rendue@example.org");
    // Une session ne rend rien : elle remettrait les limites à zéro à volonté.
    await expect(live.query("select public.release_invitation_send($1)", [fresh])).rejects.toThrow(/permission denied/);
    await live.exec("reset role");
    await live.exec("set role service_role");
    await live.query("select public.release_invitation_send($1)", [fresh]);
    // Rendre deux fois ne retire pas davantage que ce qui a été réservé.
    await live.query("select public.release_invitation_send($1)", [fresh]);
    await be(manager);
    // L'envoi raté ne compte plus : on renvoie aussitôt, sans quart d'heure.
    expect(await reserve(fresh)).toBe("rendue@example.org");
    await live.exec("reset role");
    expect(
      Number(
        (
          await live.query<{ n: number }>(
            "select count(*)::int as n from private.invitation_sends where invitation_id=$1",
            [fresh],
          )
        ).rows[0].n,
      ),
    ).toBe(1);
  });

  it("ne réserve rien pour qui n’administre pas le centre de l’invitation", async () => {
    await be(outsider);
    await expect(reserve()).rejects.toThrow("Unknown invitation");
    await be(agent);
    await expect(reserve()).rejects.toThrow("Unknown invitation");
  });

  it("ne rend aucune adresse pour une invitation déjà acceptée", async () => {
    const accepted = "50000000-0000-0000-0000-0000000000f1";
    await live.exec("reset role");
    await live.query(
      `insert into public.invitations(id,organization_id,team_id,email,display_name,role,invited_by,accepted_at,accepted_by)
       values ($1,$2,$3,'deja@example.org','Déjà','AGENT',$4,now(),$5)`,
      [accepted, org, team, manager, agent],
    );
    await be(manager);
    expect(await reserve(accepted)).toBeNull();
  });

  it("plafonne un centre à cinquante envois d’invitation par heure", async () => {
    await live.exec("reset role");
    await live.query(
      `with made as (
         insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
           select $1,$2,'lot'||g||'@example.org','Lot '||g,'AGENT',$3 from generate_series(1,51) g
         returning id, email)
       insert into private.invitation_sends(invitation_id,organization_id,email)
         select id,$1,email from made order by id limit 50`,
      [org, team, manager],
    );
    const spare = (
      await live.query<{ id: string }>(
        `select i.id from public.invitations i
          where i.email like 'lot%' and not exists (select 1 from private.invitation_sends s where s.invitation_id=i.id)`,
      )
    ).rows[0].id;
    await be(manager);
    await expect(reserve(spare)).rejects.toThrow("Too many invitations sent");
    await age("update private.invitation_sends set sent_at = sent_at - interval '2 hours'");
    await be(manager);
    expect(await reserve(spare)).toMatch(/^lot\d+@example\.org$/);
  });

  it("n’accepte qu’un rappel de campagne toutes les douze heures", async () => {
    await be(manager);
    expect(await remind()).toBe(1);
    // La file a vidé le rappel : l'ancienne règle ne l'aurait plus vu.
    await age("update public.notifications set sent_at = now() where kind = 'CAMPAIGN_REMINDER'");
    await be(manager);
    await expect(remind()).rejects.toThrow("Campaign reminded too recently");
    await age("update private.campaign_reminders set reminded_at = reminded_at - interval '13 hours'");
    await be(manager);
    expect(await remind()).toBe(1);
  });

  it("ne compte pas un rappel qui ne touchait personne", async () => {
    await age(`delete from private.campaign_reminders;
      insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ('${campaign}','${agent}','2026-12-01','DAY');
      update public.campaign_participants set validated_at = now() where campaign_id = '${campaign}';`);
    await be(manager);
    expect(await remind()).toBe(0);
    expect(await remind()).toBe(0);
  });
});

// RGPD, 23 septembre : conservation limitée et droit d'accès, en procédures.
describe("Purge des données anciennes et export d’un compte", () => {
  const org = "10000000-0000-0000-0000-0000000000a7";
  const team = "20000000-0000-0000-0000-0000000000a7";
  const manager = "30000000-0000-0000-0000-0000000000a7";
  const agent = "30000000-0000-0000-0000-0000000000a8";
  const old = "40000000-0000-0000-0000-0000000000a7";
  const recent = "40000000-0000-0000-0000-0000000000a8";
  const schedule = "60000000-0000-0000-0000-0000000000a7";
  const shift = "70000000-0000-0000-0000-0000000000a7";
  const script = (name: string) => readFileSync(new URL(`../supabase/provisioning/${name}`, import.meta.url), "utf8");
  let live: PGlite;
  const count = async (sql: string) =>
    Number((await live.query<{ n: number }>(`select count(*)::int as n ${sql}`)).rows[0].n);

  beforeEach(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    // Deux colonnes que Supabase fournit et que l'export lit.
    await live.exec(
      "alter table auth.users add column created_at timestamptz default now(), add column last_sign_in_at timestamptz",
    );
    for (const migration of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values ('${manager}','chef@example.org',now()), ('${agent}','agent@example.org',now());
      insert into public.profiles(user_id,display_name,phone) values ('${manager}','Chef',null), ('${agent}','Agent Export','0611111111');
      insert into public.organizations(id,name) values ('${org}','Centre RGPD');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${manager}','${team}','GESTIONNAIRE',true), ('${org}','${agent}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values
        ('${old}','${org}','${team}','Ancienne','2023-01-01','2023-01-01',now()-interval '1 day',now()+interval '1 day'),
        ('${recent}','${org}','${team}','Récente','2026-10-01','2026-10-01',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${old}','${agent}'), ('${org}','${recent}','${agent}');
      insert into public.availability_entries(campaign_id,user_id,date,availability_type,comment) values
        ('${old}','${agent}','2023-01-01','DAY','ancien'), ('${recent}','${agent}','2026-10-01','NIGHT','récent');
      insert into public.qualifications(organization_id,name) values ('${org}','INC1');
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount)
        values ('${org}','${old}','2023-01-01','DAY',1);
      insert into public.staffing_requirement_qualifications(organization_id,requirement_id,qualification_id,minimum)
        select '${org}', r.id, q.id, 1 from public.staffing_requirements r, public.qualifications q where r.campaign_id='${old}';
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${old}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code,published_revision,published_at)
        values ('${shift}','${org}','${schedule}','2023-01-01','DAY',1,now());
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
        values ('${org}','${shift}','${agent}',1,'CONFIRMED','${manager}');
      insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason,state,decided_at,decided_by)
        values ('${org}','${shift}','${agent}','Empêché','REFUSED',now(),'${manager}');
      update public.availability_campaigns set locked = true;
      insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by,created_at) values
        ('${org}','${team}','vieille@example.org','Vieille','AGENT','${manager}',now()-interval '4 months'),
        ('${org}','${team}','neuve@example.org','Neuve','AGENT','${manager}',now());
      insert into public.notifications(organization_id,user_id,kind,subject,created_at) values
        ('${org}','${agent}','SCHEDULE_PUBLISHED','Vieux',now()-interval '7 months'),
        ('${org}','${agent}','SCHEDULE_PUBLISHED','Neuf',now());
      update public.audit_logs set occurred_at = now() - interval '2 years';
      insert into public.audit_logs(organization_id,entity,entity_id,action,occurred_at)
        values ('${org}','team','${team}','RENAME',now());`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("efface ce qui a dépassé sa durée, et rien d’autre", async () => {
    await live.exec(`insert into private.invitation_sends(invitation_id,organization_id,email,sent_at) values
      (null,'${org}','vieille@example.org',now()-interval '4 months'), (null,'${org}','neuve@example.org',now());`);
    await live.exec(script("purger-les-donnees-anciennes.sql"));
    // Le journal des envois suit la durée des invitations.
    expect((await live.query("select email from private.invitation_sends")).rows).toEqual([
      { email: "neuve@example.org" },
    ]);
    // La campagne ancienne est partie, avec tout ce qui en dépendait.
    expect(await count(`from public.availability_campaigns where id='${old}'`)).toBe(0);
    for (const table of [
      "schedules",
      "schedule_shifts",
      "schedule_assignments",
      "shift_withdrawals",
      "staffing_requirements",
      "staffing_requirement_qualifications",
    ])
      expect(await count(`from public.${table}`), table).toBe(0);
    // La récente reste entière.
    expect(await count(`from public.availability_entries where campaign_id='${recent}'`)).toBe(1);
    expect(await count(`from public.campaign_participants where campaign_id='${recent}'`)).toBe(1);
    expect((await live.query("select email from public.invitations")).rows).toEqual([{ email: "neuve@example.org" }]);
    // Les participants ajoutés plus haut ont reçu leurs avis d'ouverture,
    // récents : seul l'ancien part.
    const subjects = (await live.query<{ subject: string }>("select subject from public.notifications")).rows;
    expect(subjects.map(r => r.subject)).toContain("Neuf");
    expect(subjects.map(r => r.subject)).not.toContain("Vieux");
    // Le journal ne garde que la ligne récente : la purge n'y a rien réécrit.
    expect((await live.query("select action from public.audit_logs")).rows).toEqual([{ action: "RENAME" }]);
    // Les déclencheurs sont rétablis : la campagne close refuse une saisie.
    await expect(
      live.query(
        "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')",
        [recent, manager],
      ),
    ).rejects.toThrow("Campaign is closed");
  });

  it("rend en une valeur JSON tout ce que la base garde d’un compte", async () => {
    const sql = script("exporter-les-donnees-d-un-compte.sql").replace("'agent@exemple.fr'", "'agent@example.org'");
    const { rows } = await live.query<{ donnees: string }>(sql);
    const data = JSON.parse(rows[0].donnees);
    expect(data.compte.email).toBe("agent@example.org");
    expect(data.fiche).toMatchObject({ display_name: "Agent Export", phone: "0611111111" });
    expect(data.rattachements).toEqual([{ centre: "Centre RGPD", equipe: "Alpha", role: "AGENT", actif: true }]);
    expect(data.campagnes.map((c: { campagne: string }) => c.campagne)).toEqual(["Ancienne", "Récente"]);
    expect(data.campagnes[1].disponibilites).toEqual([
      { date: "2026-10-01", disponibilite: "NIGHT", commentaire: "récent" },
    ]);
    expect(data.gardes).toHaveLength(1);
    expect(data.desistements[0]).toMatchObject({ motif: "Empêché", etat: "REFUSED" });
    expect(data.notifications.map((n: { sujet: string }) => n.sujet)).toEqual(
      expect.arrayContaining(["Vieux", "Neuf"]),
    );
    expect(data.journal.length).toBeGreaterThan(0);
  });
});

// C8 et C9 de l'analyse du 23 septembre : ce que 20260923140000 annonçait sans
// le tenir. Chaque cas reprend une reproduction de .local/audit-20260923/sql/.
describe("Relances et plafonds d’envoi", () => {
  const org = "10000000-0000-0000-0000-0000000000b8";
  const team = "20000000-0000-0000-0000-0000000000b8";
  const manager = "30000000-0000-0000-0000-0000000000b8";
  const agent = "30000000-0000-0000-0000-0000000000b9";
  const leaver = "30000000-0000-0000-0000-0000000000ba";
  const open = "40000000-0000-0000-0000-0000000000b8";
  const closed = "40000000-0000-0000-0000-0000000000b9";
  const schedule = "60000000-0000-0000-0000-0000000000b8";
  const shift = "70000000-0000-0000-0000-0000000000b8";
  let live: PGlite;
  const be = async (id: string | "service_role") => {
    await live.exec("reset role");
    if (id === "service_role") return live.exec("set role service_role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const sql = async (text: string, params: unknown[] = []) => {
    await live.exec("reset role");
    return live.query(text, params);
  };
  const count = async (from: string, params: unknown[] = []) =>
    Number(((await sql(`select count(*)::int as n ${from}`, params)).rows[0] as { n: number }).n);
  const remind = async (campaign = open) =>
    (await live.query<{ n: number }>("select public.remind_campaign($1) as n", [campaign])).rows[0].n;
  const reserve = async (id: string) =>
    (await live.query<{ email: string }>("select public.reserve_invitation_send($1) as email", [id])).rows[0].email;
  const invite = async (email: string) => {
    await be(manager);
    return (
      await live.query<{ id: string }>(
        `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
         values ($1,$2,$3,'Recrue','AGENT',$4) returning id`,
        [org, team, email, manager],
      )
    ).rows[0].id;
  };

  beforeEach(async () => {
    live = new PGlite();
    await live.exec(baseAuthSchema);
    for (const m of MIGRATIONS)
      await live.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${manager}','chef@example.org',now()), ('${agent}','agent@example.org',now()), ('${leaver}','parti@example.org',now());
      insert into public.profiles(user_id,display_name) values ('${manager}','Chef'), ('${agent}','Agent'), ('${leaver}','Parti');
      insert into public.organizations(id,name) values ('${org}','Centre B8');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('${org}','${leaver}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values
        ('${open}','${org}','${team}','Novembre','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '10 days'),
        ('${closed}','${org}','${team}','Septembre','2026-09-01','2026-09-01',now()-interval '30 days',now()-interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${open}','${agent}'), ('${org}','${open}','${leaver}'),
        ('${org}','${closed}','${agent}');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${open}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code,published_revision,published_at)
        values ('${shift}','${org}','${schedule}','2026-11-01','DAY',1,now());
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
        values ('${org}','${shift}','${agent}',1,'CONFIRMED','${manager}');
      update public.memberships set active = false where user_id = '${leaver}';
      delete from public.notifications;`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("relance les agents actifs, même quand le premier rappel n’est jamais parti par email", async () => {
    await be(manager);
    // L'agent désactivé participait : il n'est plus visé.
    expect(await remind()).toBe(1);
    // Sans Resend, le premier rappel reste en file, `sent_at` vide. L'ancienne
    // règle s'arrêtait là : le second rappel ne créait plus rien.
    await sql("update private.campaign_reminders set reminded_at = reminded_at - interval '13 hours'");
    await be(manager);
    expect(await remind()).toBe(1);
    expect(await count("from public.notifications where kind='CAMPAIGN_REMINDER' and user_id=$1", [agent])).toBe(2);
    expect(await count("from public.notifications where user_id=$1", [leaver])).toBe(0);
  });

  it("refuse de relancer une campagne close", async () => {
    await be(manager);
    await expect(remind(closed)).rejects.toThrow("Cannot remind a closed campaign");
    await live.query("update public.availability_campaigns set locked = true where id = $1", [open]);
    await expect(remind()).rejects.toThrow("Cannot remind a closed campaign");
  });

  it("garde les limites d’une adresse quand on efface puis refait son invitation", async () => {
    let id = await invite("cible@example.org");
    expect(await reserve(id)).toBe("cible@example.org");
    // Le geste que l'ancien message d'erreur conseillait.
    await live.query("delete from public.invitations where id = $1", [id]);
    id = await invite("cible@example.org");
    await expect(reserve(id)).rejects.toThrow("Invitation sent too recently");
    // Cinq envois en vingt-quatre heures, pas davantage, invitation refaite ou non.
    for (let sent = 1; sent < 5; sent++) {
      await sql("update private.invitation_sends set sent_at = sent_at - interval '20 minutes'");
      await be(manager);
      await live.query("delete from public.invitations where id = $1", [id]);
      id = await invite("cible@example.org");
      expect(await reserve(id)).toBe("cible@example.org");
    }
    await sql("update private.invitation_sends set sent_at = sent_at - interval '20 minutes'");
    await be(manager);
    await expect(reserve(id)).rejects.toThrow("Invitation send limit reached");
    await sql("update private.invitation_sends set sent_at = sent_at - interval '25 hours'");
    await be(manager);
    expect(await reserve(id)).toBe("cible@example.org");
  });

  it("compte au plafond du centre les envois, y compris ceux d’invitations effacées", async () => {
    await sql(
      `insert into private.invitation_sends(invitation_id,organization_id,email)
         select null,$1,'effacee'||g||'@example.org' from generate_series(1,50) g`,
      [org],
    );
    const id = await invite("nouvelle@example.org");
    await expect(reserve(id)).rejects.toThrow("Too many invitations sent");
  });

  it("ne réécrit pas à l’encadrement une demande de désistement refaite dans les douze heures", async () => {
    const requests = () =>
      count("from public.notifications where kind='WITHDRAWAL_REQUESTED' and user_id=$1", [manager]);
    const ask = async () => {
      await be(agent);
      await live.query(
        "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,'Empêché')",
        [org, shift, agent],
      );
    };
    const cancel = async () => {
      await be(agent);
      await live.query("update public.shift_withdrawals set state='CANCELLED' where user_id=$1 and state='PENDING'", [
        agent,
      ]);
    };
    await ask();
    expect(await requests()).toBe(1);
    for (let turn = 0; turn < 5; turn++) {
      await cancel();
      await ask();
    }
    // Six demandes, une seule notification : les suivantes sont à l'écran Demandes.
    expect(await count("from public.shift_withdrawals where user_id=$1", [agent])).toBe(6);
    expect(await requests()).toBe(1);
    // Douze heures plus tard, une nouvelle demande prévient de nouveau.
    await cancel();
    await sql("update public.shift_withdrawals set created_at = created_at - interval '13 hours'");
    await ask();
    expect(await requests()).toBe(2);
  });

  it("n’envoie pas plus de dix emails par heure à une personne, et aucun à un membre désactivé", async () => {
    await sql(
      `insert into public.notifications(organization_id,user_id,kind,subject)
         select $1,$2,'SCHEDULE_PUBLISHED','Publication '||g from generate_series(1,15) g`,
      [org, agent],
    );
    await sql(
      "insert into public.notifications(organization_id,user_id,kind,subject) values ($1,$2,'SCHEDULE_PUBLISHED','Au parti')",
      [org, leaver],
    );
    const claim = async () => {
      await be("service_role");
      return (await live.query<{ email: string }>("select email from public.claim_email_deliveries(50)")).rows;
    };
    const first = await claim();
    expect(first.filter(r => r.email === "agent@example.org")).toHaveLength(10);
    expect(first.filter(r => r.email === "parti@example.org")).toHaveLength(0);
    expect((await sql("select email_status from public.notifications where user_id=$1", [leaver])).rows).toEqual([
      { email_status: "skipped" },
    ]);
    // Les dix partent ; les cinq autres attendent l'heure suivante, sans être perdus.
    await sql(
      "update public.notifications set email_status='sent', sent_at=now(), email_lease=null where email_status='sending'",
    );
    expect(await claim()).toHaveLength(0);
    expect(await count("from public.notifications where user_id=$1 and email_status='pending'", [agent])).toBe(5);
    await sql("update public.notifications set sent_at = sent_at - interval '2 hours' where email_status='sent'");
    expect(await claim()).toHaveLength(5);
  });
});

// C5 de l'analyse du 23 septembre : une campagne par mois et par équipe.
describe("Une campagne par mois et par équipe", () => {
  const org = "10000000-0000-0000-0000-0000000000c5";
  const alpha = "20000000-0000-0000-0000-0000000000c5";
  const bravo = "20000000-0000-0000-0000-0000000000c6";
  const manager = "30000000-0000-0000-0000-0000000000c5";
  const seed = `
    insert into auth.users(id) values ('${manager}');
    insert into public.profiles(user_id,display_name) values ('${manager}','Chef');
    insert into public.organizations(id,name) values ('${org}','Centre C5');
    insert into public.teams(id,organization_id,name) values ('${alpha}','${org}','Alpha'), ('${bravo}','${org}','Bravo');
    insert into public.memberships values ('${org}','${manager}','${alpha}','GESTIONNAIRE',true);`;
  const open = (live: PGlite, team: string) =>
    live.query("select public.create_campaign($1,$2,'Disponibilités de novembre','2099-11-01','2099-10-25')", [
      org,
      team,
    ]);

  it("refuse une seconde campagne du même mois pour la même équipe, pas pour une autre", async () => {
    const live = await freshDatabase();
    await live.exec(seed);
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [manager]);
    await live.exec("set role authenticated");
    await open(live, alpha);
    await expect(open(live, alpha)).rejects.toThrow("availability_campaigns_team_month_key");
    // Une autre équipe du centre garde sa propre campagne de novembre.
    await open(live, bravo);
    await live.exec("reset role");
    expect(
      (await live.query<{ n: number }>("select count(*)::int as n from public.availability_campaigns")).rows[0].n,
    ).toBe(2);
    await live.close();
  });

  it("ne s’applique pas sur une base qui porte déjà un doublon, et dit pourquoi", async () => {
    const live = new PGlite();
    await live.exec(baseAuthSchema);
    // Par son nom et non par sa place : d'autres migrations la suivent.
    const target = MIGRATIONS.indexOf("20260924090000_campagne_unique.sql");
    for (const migration of MIGRATIONS.slice(0, target))
      await live.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    await live.exec(`${seed}
      insert into public.availability_campaigns(organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values
        ('${org}','${alpha}','Novembre','2099-11-01','2099-11-30',now(),now()+interval '1 day'),
        ('${org}','${alpha}','Novembre bis','2099-11-01','2099-11-30',now(),now()+interval '1 day');`);
    await expect(
      live.exec(readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8")),
    ).rejects.toThrow("deux campagnes existent déjà pour la même équipe et le même mois");
    await live.close();
  });
});

// B1 de l'analyse du 25 septembre : un agent arrivé après l'ouverture d'une
// campagne n'y était jamais inscrit. L'ordre recommandé pour le pilote —
// ouvrir, puis inviter — laissait ainsi chaque agent invité devant « Aucune
// campagne ne vous concerne », sans que l'encadrement puisse rien y faire.
describe("Inscription aux campagnes ouvertes d’un membre qui arrive", () => {
  const org = "10000000-0000-0000-0000-0000000000d5";
  const alpha = "20000000-0000-0000-0000-0000000000d5";
  const bravo = "20000000-0000-0000-0000-0000000000d6";
  const admin = "30000000-0000-0000-0000-0000000000d5";
  const late = "30000000-0000-0000-0000-0000000000d6";
  const existing = "30000000-0000-0000-0000-0000000000d7";
  const dormant = "30000000-0000-0000-0000-0000000000d8";
  const mover = "30000000-0000-0000-0000-0000000000d9";
  const open = "40000000-0000-0000-0000-0000000000d5";
  const locked = "40000000-0000-0000-0000-0000000000d6";
  const closed = "40000000-0000-0000-0000-0000000000d7";
  const bravoOpen = "40000000-0000-0000-0000-0000000000d8";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const campaignsOf = async (user: string) => {
    await be(null);
    return (
      await live.query<{ campaign_id: string }>(
        "select campaign_id from public.campaign_participants where user_id=$1 order by campaign_id",
        [user],
      )
    ).rows.map(row => row.campaign_id);
  };
  const openingNotices = async (user: string) => {
    await be(null);
    return (
      await live.query<{ subject: string }>(
        "select subject from public.notifications where user_id=$1 and kind='CAMPAIGN_OPENED' order by subject",
        [user],
      )
    ).rows.map(row => row.subject);
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${admin}','admin@d5.test',now()), ('${existing}','deja@d5.test',now()),
        ('${dormant}','ancien@d5.test',now()), ('${mover}','mobile@d5.test',now());
      insert into public.profiles(user_id,display_name) values
        ('${admin}','Admin'), ('${dormant}','Ancien'), ('${mover}','Mobile');
      insert into public.organizations(id,name) values ('${org}','Centre D5');
      insert into public.teams(id,organization_id,name) values ('${alpha}','${org}','Alpha'), ('${bravo}','${org}','Bravo');
      insert into public.memberships values
        ('${org}','${admin}','${alpha}','ADMIN',true),
        ('${org}','${dormant}','${alpha}','AGENT',false),
        ('${org}','${mover}','${bravo}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at,locked) values
        ('${open}','${org}','${alpha}','Octobre Alpha','2026-10-01','2026-10-01',now()-interval '1 day',now()+interval '9 days',false),
        ('${locked}','${org}','${alpha}','Novembre Alpha','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '9 days',true),
        ('${closed}','${org}','${alpha}','Septembre Alpha','2026-09-01','2026-09-01',now()-interval '30 days',now()-interval '1 day',false),
        ('${bravoOpen}','${org}','${bravo}','Octobre Bravo','2026-10-01','2026-10-01',now()-interval '1 day',now()+interval '9 days',false);`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("inscrit l’agent invité après l’ouverture, qui est prévenu et peut répondre", async () => {
    await be(admin);
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,'tardif@d5.test','Tardif','AGENT',$3)`,
      [org, alpha, admin],
    );
    await be(null);
    await live.query("insert into auth.users(id,email,email_confirmed_at) values ($1,'tardif@d5.test',now())", [late]);
    // La campagne ouverte de son équipe, et elle seule : ni la verrouillée, ni
    // la close, ni celle d'une autre équipe.
    expect(await campaignsOf(late)).toEqual([open]);
    expect(await openingNotices(late)).toEqual(["Campagne ouverte : Octobre Alpha"]);
    // Ce qui lui était refusé : écrire, puis valider.
    await be(late);
    await live.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')",
      [open, late],
    );
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
      open,
      late,
    ]);
    await be(null);
    const validated = await live.query(
      "select validated_at is not null as validated from public.campaign_participants where user_id=$1",
      [late],
    );
    expect(validated.rows).toEqual([{ validated: true }]);
  });

  it("inscrit aussi le compte déjà confirmé, rattaché dès l’invitation", async () => {
    await be(admin);
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,'deja@d5.test','Déjà là','AGENT',$3)`,
      [org, alpha, admin],
    );
    expect(await campaignsOf(existing)).toEqual([open]);
  });

  it("inscrit le membre réactivé, une seule fois", async () => {
    expect(await campaignsOf(dormant)).toEqual([]);
    await be(admin);
    await live.query("update public.memberships set active=true where organization_id=$1 and user_id=$2", [
      org,
      dormant,
    ]);
    expect(await campaignsOf(dormant)).toEqual([open]);
    // Désactivé puis réactivé : sa participation demeure, sans doublon ni
    // second avis.
    await be(admin);
    await live.query("update public.memberships set active=false where organization_id=$1 and user_id=$2", [
      org,
      dormant,
    ]);
    expect(await campaignsOf(dormant)).toEqual([open]);
    await be(admin);
    await live.query("update public.memberships set active=true where organization_id=$1 and user_id=$2", [
      org,
      dormant,
    ]);
    expect(await campaignsOf(dormant)).toEqual([open]);
    expect(await openingNotices(dormant)).toHaveLength(1);
  });

  it("inscrit le membre qui change d’équipe aux campagnes ouvertes de la nouvelle, sans rien lui retirer", async () => {
    expect(await campaignsOf(mover)).toEqual([]);
    await be(admin);
    await live.query("update public.memberships set team_id=$3 where organization_id=$1 and user_id=$2", [
      org,
      mover,
      alpha,
    ]);
    expect(await campaignsOf(mover)).toEqual([open]);
    // Revenu dans Bravo, il y retrouve la campagne de Bravo, et garde celle
    // d'Alpha avec ce qu'il y aurait saisi.
    await be(admin);
    await live.query("update public.memberships set team_id=$3 where organization_id=$1 and user_id=$2", [
      org,
      mover,
      bravo,
    ]);
    expect(await campaignsOf(mover)).toEqual([open, bravoOpen].sort());
  });

  it("n’inscrit personne en changeant autre chose que l’activité ou l’équipe", async () => {
    const before = await campaignsOf(mover);
    await be(admin);
    await live.query("update public.memberships set role='GESTIONNAIRE' where organization_id=$1 and user_id=$2", [
      org,
      mover,
    ]);
    expect(await campaignsOf(mover)).toEqual(before);
    expect(await openingNotices(mover)).toHaveLength(2);
  });

  it("garde l’inscription hors de portée d’une session", async () => {
    await be(late);
    await expect(live.query("select private.join_open_campaigns($1,$2,$3)", [org, late, bravo])).rejects.toThrow(
      /permission denied/,
    );
    expect(await campaignsOf(late)).toEqual([open]);
  });
});

// Le rattrapage de la migration : ceux qui étaient déjà arrivés trop tard sur le
// projet hébergé — le pilote a pu inviter ses agents avant ce correctif.
describe("Migration 20260925090000 — rattrapage des arrivées tardives", () => {
  const org = "10000000-0000-0000-0000-0000000000de";
  const team = "20000000-0000-0000-0000-0000000000de";
  const admin = "30000000-0000-0000-0000-0000000000de";
  const late = "30000000-0000-0000-0000-0000000000df";
  const campaign = "40000000-0000-0000-0000-0000000000de";
  // Par son nom et non par sa place : d'autres migrations la suivent.
  const target = MIGRATIONS.indexOf("20260925090000_participants_en_cours.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("inscrit et prévient les membres actifs absents d’une campagne ouverte de leur équipe", async () => {
    expect(target).toBeGreaterThan(0);
    const db = await upTo(target);
    // Avant le correctif : la campagne est ouverte, puis l'agent arrive.
    await db.exec(`
      insert into auth.users(id,email,email_confirmed_at) values ('${admin}','admin@de.test',now()), ('${late}','tardif@de.test',now());
      insert into public.profiles(user_id,display_name) values ('${admin}','Admin'), ('${late}','Tardif');
      insert into public.organizations(id,name) values ('${org}','Centre DE');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${admin}','${team}','ADMIN',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Octobre','2026-10-01','2026-10-01',now()-interval '1 day',now()+interval '9 days');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${org}','${campaign}','${admin}');
      insert into public.memberships values ('${org}','${late}','${team}','AGENT',true);`);
    const participants = async () =>
      (
        await db.query<{ user_id: string }>(
          "select user_id from public.campaign_participants where campaign_id=$1 order by user_id",
          [campaign],
        )
      ).rows.map(row => row.user_id);
    // Le défaut, tel qu'il était.
    expect(await participants()).toEqual([admin]);

    await db.exec(migration());
    expect(await participants()).toEqual([admin, late]);
    expect((await db.query("select kind from public.notifications where user_id=$1", [late])).rows).toEqual([
      { kind: "CAMPAIGN_OPENED" },
    ]);
    // L'administrateur, déjà inscrit, ne reçoit pas un second avis.
    expect(
      (await db.query("select count(*)::int as n from public.notifications where user_id=$1", [admin])).rows,
    ).toEqual([{ n: 1 }]);

    await expect(db.exec(migration())).rejects.toThrow("déjà été appliquée");
    await db.close();
  }, 60000);

  it("refuse de s’appliquer avant la migration dont elle dépend", async () => {
    const db = await upTo(target - 1);
    await expect(db.exec(migration())).rejects.toThrow("20260924090000_campagne_unique.sql");
    await db.close();
  }, 60000);
});

// C1 et C2 de l'analyse du 25 septembre : la garde qui évite de renotifier
// l'encadrement se fiait à une date écrite par l'agent, et ignorait l'état de
// la demande précédente. Reproduits dans .local/audit-20260925/sql/.
describe("Désistements : ce qui prévient l’encadrement", () => {
  const org = "10000000-0000-0000-0000-0000000000e5";
  const team = "20000000-0000-0000-0000-0000000000e5";
  const manager = "30000000-0000-0000-0000-0000000000e5";
  const agent = "30000000-0000-0000-0000-0000000000e6";
  const campaign = "40000000-0000-0000-0000-0000000000e5";
  const schedule = "60000000-0000-0000-0000-0000000000e5";
  const shift = "70000000-0000-0000-0000-0000000000e5";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const announced = async () => {
    await be(null);
    return (
      await live.query<{ body: string }>(
        "select body from public.notifications where kind='WITHDRAWAL_REQUESTED' and user_id=$1 order by created_at, id",
        [manager],
      )
    ).rows.map(row => row.body);
  };
  const ask = async (reason: string) => {
    await be(agent);
    await live.query(
      "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,$4)",
      [org, shift, agent, reason],
    );
  };
  const pending = async () => {
    await be(null);
    return (
      await live.query<{ id: string }>("select id from public.shift_withdrawals where user_id=$1 and state='PENDING'", [
        agent,
      ])
    ).rows[0].id;
  };

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${manager}','chef@e5.test',now()), ('${agent}','agent@e5.test',now());
      insert into public.profiles(user_id,display_name) values ('${manager}','Chef'), ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre E5');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '10 days');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code,published_revision,published_at)
        values ('${shift}','${org}','${schedule}','2026-11-01','DAY',1,now());
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
        values ('${org}','${shift}','${agent}',1,'CONFIRMED','${manager}');`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("refuse une demande qui porte sa propre date ou son propre état", async () => {
    await be(agent);
    await expect(
      live.query(
        `insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason,created_at)
         values ($1,$2,$3,'Antidatée','2000-01-01')`,
        [org, shift, agent],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      live.query(
        `insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason,state)
         values ($1,$2,$3,'Déjà tranchée','PENDING')`,
        [org, shift, agent],
      ),
    ).rejects.toThrow(/permission denied/);
    // Les quatre colonnes que l'application envoie suffisent : la date est celle
    // de la base.
    await ask("Convocation");
    await be(null);
    const stamped = await live.query<{ fresh: boolean }>(
      "select created_at > now() - interval '1 minute' as fresh from public.shift_withdrawals where user_id=$1",
      [agent],
    );
    expect(stamped.rows).toEqual([{ fresh: true }]);
  });

  it("ne laisse plus notifier l’encadrement en boucle", async () => {
    // Ce que l'antidatage permettait : dix allers-retours, dix notifications.
    // Sans lui, la boucle retombe sur la garde des douze heures.
    for (let turn = 0; turn < 10; turn++) {
      await ask("Empêché");
      await be(agent);
      await live.query("update public.shift_withdrawals set state='CANCELLED' where user_id=$1 and state='PENDING'", [
        agent,
      ]);
    }
    expect(await announced()).toHaveLength(1);
  });

  it("annonce une nouvelle demande après un refus, même dans les douze heures", async () => {
    await ask("Enfant malade");
    const first = await pending();
    await be(manager);
    await live.query("update public.shift_withdrawals set state='REFUSED' where id=$1", [first]);
    // Deux heures plus tard, un motif nouveau : c'est une nouvelle affaire.
    await ask("Enfant hospitalisé");
    expect(await announced()).toEqual(["Motif : Enfant malade", "Motif : Enfant hospitalisé"]);
  });

  it("n’annonce pas de nouveau une demande retirée puis refaite dans les douze heures", async () => {
    await ask("Empêché");
    await be(agent);
    await live.query("update public.shift_withdrawals set state='CANCELLED' where user_id=$1", [agent]);
    await ask("Empêché, finalement");
    expect(await announced()).toEqual(["Motif : Empêché"]);
  });

  it("garde le reste de la notification tel quel : décision annoncée à l’agent", async () => {
    await ask("Convocation");
    const id = await pending();
    await be(manager);
    await live.query("update public.shift_withdrawals set state='ACCEPTED' where id=$1", [id]);
    await be(null);
    const decided = await live.query<{ subject: string }>(
      "select subject from public.notifications where kind='WITHDRAWAL_DECIDED' and user_id=$1",
      [agent],
    );
    expect(decided.rows).toEqual([{ subject: "Désistement accepté — garde de jour du 01/11/2026" }]);
  });
});

describe("Migration 20260925150000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20260925150000_desistements_notification.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20260925090000_participants_en_cours.sql");
    await early.close();
  }, 90000);
});

// Points mineurs de l'analyse du 25 septembre, corrigés par 20260925180000.
// Chacun reproduit le défaut tel que l'audit l'avait constaté
// (.local/audit-20260925/sql/open-items.test.ts), puis vérifie ce qui reste
// permis.
describe("Correctifs mineurs du 25 septembre", () => {
  const org = "10000000-0000-0000-0000-0000000000f5";
  const team = "20000000-0000-0000-0000-0000000000f5";
  const manager = "30000000-0000-0000-0000-0000000000f5";
  const agent = "30000000-0000-0000-0000-0000000000f6";
  const campaign = "40000000-0000-0000-0000-0000000000f5";
  const schedule = "60000000-0000-0000-0000-0000000000f5";
  const shift = "70000000-0000-0000-0000-0000000000f5";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const seed = `
    insert into auth.users(id,email,email_confirmed_at) values
      ('${manager}','chef@f5.test',now()), ('${agent}','agent@f5.test',now());
    insert into public.profiles(user_id,display_name) values ('${manager}','Chef'), ('${agent}','Agent');
    insert into public.organizations(id,name) values ('${org}','Centre F5');
    insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
    insert into public.memberships values
      ('${org}','${manager}','${team}','GESTIONNAIRE',true),
      ('${org}','${agent}','${team}','AGENT',true);
    insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
      values ('${campaign}','${org}','${team}','Novembre','2099-11-01','2099-11-01',now()-interval '1 day',now()+interval '10 days');
    insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
    insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code,published_revision,published_at)
      values ('${shift}','${org}','${schedule}','2099-11-01','DAY',1,now());
    insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
      values ('${org}','${shift}','${agent}',1,'CONFIRMED','${manager}');`;
  const requirement = (total: number, minima: Record<string, number>) =>
    live.query("select public.set_staffing_requirement($1,'2099-11-01','DAY',$2,$3)", [
      campaign,
      total,
      JSON.stringify(minima),
    ]);
  const requirementState = async () => {
    await be(null);
    const headcount = (await live.query<{ headcount: number }>("select headcount from public.staffing_requirements"))
      .rows;
    const minima = (
      await live.query<{ name: string; minimum: number }>(
        `select q.name, rq.minimum from public.staffing_requirement_qualifications rq
           join public.qualifications q on q.id = rq.qualification_id order by q.name`,
      )
    ).rows;
    return { headcount, minima };
  };

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(seed);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("refuse à l’encadrement de retirer la demande d’un agent à sa place", async () => {
    await be(agent);
    await live.query(
      "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,'Empêché')",
      [org, shift, agent],
    );
    await be(manager);
    await expect(
      live.query("update public.shift_withdrawals set state='CANCELLED' where user_id=$1", [agent]),
    ).rejects.toThrow("row-level security");
    await be(null);
    expect((await live.query("select state from public.shift_withdrawals")).rows).toEqual([{ state: "PENDING" }]);
    // Trancher reste permis, et retirer reste le geste de l'agent.
    await be(manager);
    await live.query("update public.shift_withdrawals set state='REFUSED' where user_id=$1", [agent]);
    await be(agent);
    await live.query(
      "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,'Empêché, encore')",
      [org, shift, agent],
    );
    await live.query("update public.shift_withdrawals set state='CANCELLED' where user_id=$1 and state='PENDING'", [
      agent,
    ]);
    await be(null);
    expect((await live.query("select state, decided_by from public.shift_withdrawals order by state")).rows).toEqual([
      { state: "CANCELLED", decided_by: null },
      { state: "REFUSED", decided_by: manager },
    ]);
  });

  it("ferme l’ancienne file d’emails à toute session", async () => {
    await be(null);
    const rights = (
      await live.query<{ fn: string; authenticated: boolean; anon: boolean }>(
        `select p.proname as fn,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('pending_notifications', 'mark_notifications_sent')
          order by 1`,
      )
    ).rows;
    expect(rights).toEqual([
      { fn: "mark_notifications_sent", authenticated: false, anon: false },
      { fn: "pending_notifications", authenticated: false, anon: false },
    ]);
  });

  it("ne laisse aucune fonction à anon, même sous les privilèges par défaut de Supabase", async () => {
    // Supabase accorde par défaut à anon l'exécution de toute fonction créée
    // dans public : seul un retrait nommé la lui ôte. Le montage des autres
    // parcours n'émule pas ce défaut, d'où cette base-ci.
    const supabase = new PGlite();
    await supabase.exec(baseAuthSchema);
    await supabase.exec(`
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      grant usage on schema public to anon;`);
    for (const m of MIGRATIONS)
      await supabase.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    const open = (
      await supabase.query<{ fn: string }>(
        `select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute') order by 1`,
      )
    ).rows.map(row => row.fn);
    expect(open).toEqual([]);
    // Les deux que l'audit avait relevées restent ouvertes à une session.
    expect(
      (
        await supabase.query<{ member: boolean; requirement: boolean }>(
          `select has_function_privilege('authenticated', 'public.save_member(uuid,uuid,uuid,text,boolean,text,text,text,text,text,text[])', 'execute') as member,
                  has_function_privilege('authenticated', 'public.set_staffing_requirement(uuid,date,text,integer,jsonb)', 'execute') as requirement`,
        )
      ).rows,
    ).toEqual([{ member: true, requirement: true }]);
    await supabase.close();
  }, 60000);

  it("refuse de baisser l’effectif sous un minimum par une mise à jour directe", async () => {
    await be(manager);
    await requirement(3, { SAP: 2 });
    await expect(
      live.query("update public.staffing_requirements set headcount=1 where campaign_id=$1", [campaign]),
    ).rejects.toThrow("Headcount is below a qualification minimum");
    expect(await requirementState()).toEqual({ headcount: [{ headcount: 3 }], minima: [{ name: "SAP", minimum: 2 }] });
    // Égal au minimum, ou au-dessus : permis.
    await be(manager);
    await live.query("update public.staffing_requirements set headcount=2 where campaign_id=$1", [campaign]);
    await live.query("update public.staffing_requirements set headcount=6 where campaign_id=$1", [campaign]);
    expect((await requirementState()).headcount).toEqual([{ headcount: 6 }]);
  });

  it("laisse set_staffing_requirement baisser l’effectif et le minimum d’un même geste", async () => {
    await be(manager);
    await requirement(3, { SAP: 2 });
    await requirement(1, { SAP: 1 });
    expect(await requirementState()).toEqual({ headcount: [{ headcount: 1 }], minima: [{ name: "SAP", minimum: 1 }] });
    // Baisser l'effectif en retirant le minimum.
    await be(manager);
    await requirement(4, { SAP: 4 });
    await requirement(1, {});
    expect(await requirementState()).toEqual({ headcount: [{ headcount: 1 }], minima: [] });
    // Le refus d'un minimum trop haut reste entier : rien ne change.
    await be(manager);
    await requirement(3, { SAP: 2 });
    await expect(requirement(1, { SAP: 2 })).rejects.toThrow("Qualification minimum exceeds the required headcount");
    expect(await requirementState()).toEqual({ headcount: [{ headcount: 3 }], minima: [{ name: "SAP", minimum: 2 }] });
  });

  it("refuse une seconde campagne du même mois qui ne commencerait pas le premier", async () => {
    await be(manager);
    await expect(
      live.query(
        `insert into public.availability_campaigns(organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
         values ($1,$2,'Novembre bis','2099-11-02','2099-11-30',now(),now()+interval '1 day')`,
        [org, team],
      ),
    ).rejects.toThrow("availability_campaigns_starts_on_first_day");
    await be(null);
    expect(
      (await live.query<{ n: number }>("select count(*)::int as n from public.availability_campaigns")).rows[0].n,
    ).toBe(1);
  });

  it("nettoie les noms de qualification, sans fantôme ni doublon, et refuse un nom vide", async () => {
    await be(manager);
    await requirement(4, { SAP: 1 });
    await requirement(4, { "SAP ": 1, " SAP": 2, "Chef\t": 1 });
    expect(await requirementState()).toEqual({
      headcount: [{ headcount: 4 }],
      minima: [
        { name: "Chef", minimum: 1 },
        { name: "SAP", minimum: 2 },
      ],
    });
    expect((await live.query("select name from public.qualifications order by name")).rows).toEqual([
      { name: "Chef" },
      { name: "SAP" },
    ]);
    await be(manager);
    await expect(requirement(4, { "  ": 1 })).rejects.toThrow("Qualification name is empty");
    expect((await requirementState()).minima).toHaveLength(2);
  });
});

describe("Migration 20260925180000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20260925180000_correctifs_mineurs.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20260925150000_desistements_notification.sql");
    await early.close();
  }, 90000);

  it("ne s’applique pas sur une base qui porte une campagne commencée en cours de mois, et dit pourquoi", async () => {
    const org = "10000000-0000-0000-0000-0000000000f7";
    const team = "20000000-0000-0000-0000-0000000000f7";
    const db = await upTo(target);
    await db.exec(`
      insert into public.organizations(id,name) values ('${org}','Centre F7');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.availability_campaigns(organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values
        ('${org}','${team}','Novembre','2099-11-01','2099-11-30',now(),now()+interval '1 day'),
        ('${org}','${team}','Novembre bis','2099-11-02','2099-11-30',now(),now()+interval '1 day');`);
    await expect(db.exec(migration())).rejects.toThrow("ne commence pas le premier du mois");
    // Rien n'a été appliqué : la transaction est annulée en entier, comme dans
    // l'éditeur SQL, qui la clôt après le refus.
    await db.exec("rollback");
    expect((await db.query("select to_regproc('private.check_requirement_headcount') as fn")).rows).toEqual([
      { fn: null },
    ]);
    await db.close();
  }, 90000);
});

// Bilan avant déploiement du 27 septembre : chaque parcours ci-dessous
// échouait sur le schéma de 20260925180000.
describe("Bilan du 27 septembre — un appareil qui se réinscrit ou change de main", () => {
  const org = "10000000-0000-0000-0000-0000000000d0";
  const team = "20000000-0000-0000-0000-0000000000d0";
  const alice = "30000000-0000-0000-0000-0000000000d0";
  const bob = "30000000-0000-0000-0000-0000000000d1";
  const phone = "https://fcm.googleapis.com/fcm/send/tablette-du-centre";
  const p256dh = "B".repeat(87);
  const auth = "A".repeat(22);
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const register = async (claim?: boolean, keys = { p256dh, auth }) =>
    (
      await live.query<{ registered: boolean }>(
        claim === undefined
          ? "select public.register_push_subscription($1,$2,$3) as registered"
          : "select public.register_push_subscription($1,$2,$3,$4) as registered",
        claim === undefined ? [phone, keys.p256dh, keys.auth] : [phone, keys.p256dh, keys.auth, claim],
      )
    ).rows[0].registered;
  const notify = async (user: string) => {
    await live.exec("reset role");
    await live.query(
      "insert into public.notifications(organization_id,user_id,kind,subject) values ($1,$2,'SCHEDULE_PUBLISHED','Votre planning a été publié')",
      [org, user],
    );
  };
  const device = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ id: string; user_id: string; p256dh: string }>(
        "select id, user_id, p256dh from public.push_subscriptions where endpoint=$1",
        [phone],
      )
    ).rows;
  };
  const deliveries = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ user_id: string; status: string }>(
        `select n.user_id, d.status from public.push_deliveries d
           join public.notifications n on n.id = d.notification_id order by n.created_at`,
      )
    ).rows;
  };

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${alice}'), ('${bob}');
      insert into public.profiles(user_id,display_name) values ('${alice}','Alice'), ('${bob}','Bob');
      insert into public.organizations(id,name) values ('${org}','Centre D0');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${alice}','${team}','AGENT',true),
        ('${org}','${bob}','${team}','AGENT',true);`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("garde l’abonnement et ses envois en attente quand le même compte le redit", async () => {
    await be(alice);
    expect(await register()).toBe(true);
    const [before] = await device();
    await notify(alice);
    expect(await deliveries()).toEqual([{ user_id: alice, status: "pending" }]);
    // L'ouverture de l'application, puis l'activation depuis le profil.
    await be(alice);
    expect(await register(false)).toBe(true);
    await be(alice);
    expect(await register(true)).toBe(true);
    const [after] = await device();
    expect(after.id).toBe(before.id);
    expect(await deliveries()).toEqual([{ user_id: alice, status: "pending" }]);
  });

  it("laisse le serveur estampiller l’envoi en cours, et rafraîchit les clés", async () => {
    await be(alice);
    await register();
    await notify(alice);
    await live.exec("reset role");
    await live.exec("set role service_role");
    const [job] = (
      await live.query<{ id: string; lease: string }>("select id, lease from public.claim_push_deliveries()")
    ).rows;
    // Le navigateur a renouvelé ses clés pendant l'envoi.
    await be(alice);
    await register(false, { p256dh: "C".repeat(87), auth });
    await live.exec("reset role");
    await live.exec("set role service_role");
    await live.query("select public.finish_push_delivery($1,$2,201)", [job.id, job.lease]);
    expect(await deliveries()).toEqual([{ user_id: alice, status: "sent" }]);
    expect((await device())[0].p256dh).toBe("C".repeat(87));
  });

  it("ne passe pas l’appareil d’Alice à Bob parce qu’il s’est connecté dessus", async () => {
    await be(alice);
    await register();
    await notify(alice);
    // Bob n'a jamais accepté les notifications : l'application ne réclame pas.
    await be(bob);
    expect(await register(false)).toBe(false);
    expect((await device()).map(d => d.user_id)).toEqual([alice]);
    expect(await deliveries()).toEqual([{ user_id: alice, status: "pending" }]);
  });

  it("n’inscrit pas un appareil libre pour un compte qui ne le réclame pas", async () => {
    await be(bob);
    expect(await register(false)).toBe(false);
    expect(await device()).toEqual([]);
  });

  it("le passe à celui qui le réclame, sans emporter les envois du précédent", async () => {
    await be(alice);
    await register();
    await notify(alice);
    await be(bob);
    expect(await register(true)).toBe(true);
    expect((await device()).map(d => d.user_id)).toEqual([bob]);
    // Les gardes d'Alice ne s'affichent pas sur l'écran verrouillé de Bob.
    expect(await deliveries()).toEqual([]);
    await notify(bob);
    expect(await deliveries()).toEqual([{ user_id: bob, status: "pending" }]);
  });

  it("ferme la nouvelle signature à anon, comme l’ancienne", async () => {
    await live.exec("reset role");
    expect(
      (
        await live.query<{ anon: boolean; authenticated: boolean; old: string | null }>(
          `select has_function_privilege('anon', 'public.register_push_subscription(text,text,text,boolean)', 'execute') as anon,
                  has_function_privilege('authenticated', 'public.register_push_subscription(text,text,text,boolean)', 'execute') as authenticated,
                  to_regprocedure('public.register_push_subscription(text,text,text)')::text as old`,
        )
      ).rows,
    ).toEqual([{ anon: false, authenticated: true, old: null }]);
  });
});

describe("Bilan du 27 septembre — la republication prévient ceux qu’elle retire", () => {
  const org = "10000000-0000-0000-0000-0000000000d2";
  const team = "20000000-0000-0000-0000-0000000000d2";
  const manager = "30000000-0000-0000-0000-0000000000d2";
  const alice = "30000000-0000-0000-0000-0000000000d3";
  const bob = "30000000-0000-0000-0000-0000000000d4";
  const campaign = "40000000-0000-0000-0000-0000000000d2";
  const schedule = "60000000-0000-0000-0000-0000000000d2";
  const shift = "70000000-0000-0000-0000-0000000000d2";
  const phone = "https://fcm.googleapis.com/fcm/send/telephone-d-alice";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const publish = async () => {
    await be(manager);
    await live.query("select private.publish_schedule_shift($1)", [shift]);
  };
  const draft = async (...users: string[]) => {
    await be(manager);
    await live.query("delete from public.schedule_assignments where schedule_shift_id=$1 and revision=0", [shift]);
    for (const user of users)
      await live.query(
        "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
        [org, shift, user, manager],
      );
  };
  const notices = async (user: string) => {
    await live.exec("reset role");
    return (
      await live.query<{ subject: string; body: string; email_status: string; pushes: number }>(
        `select n.subject, n.body, n.email_status,
                (select count(*)::int from public.push_deliveries d where d.notification_id = n.id) as pushes
           from public.notifications n
          where n.user_id = $1 and n.kind = 'SCHEDULE_PUBLISHED' order by n.created_at, n.subject`,
        [user],
      )
    ).rows;
  };

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id,email) values
        ('${manager}','chef@d2.test'), ('${alice}','alice@d2.test'), ('${bob}','bob@d2.test');
      insert into public.profiles(user_id,display_name) values
        ('${manager}','Chef'), ('${alice}','Alice'), ('${bob}','Bob');
      insert into public.organizations(id,name) values ('${org}','Centre D2');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${alice}','${team}','AGENT',true),
        ('${org}','${bob}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2099-11-01','2099-11-01',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${campaign}','${alice}'), ('${org}','${campaign}','${bob}');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        values ('${shift}','${org}','${schedule}','2099-11-01','NIGHT');
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount)
        values ('${org}','${campaign}','2099-11-01','NIGHT',1);`);
    for (const agent of [alice, bob]) {
      await be(agent);
      await live.query(
        "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2099-11-01','FULL_24H')",
        [campaign, agent],
      );
      await live.query(
        "update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2",
        [campaign, agent],
      );
    }
    await be(alice);
    await live.query("select public.register_push_subscription($1,$2,$3)", [phone, "B".repeat(87), "A".repeat(22)]);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("prévient l’agent retiré, par le centre de messages, l’email et le téléphone", async () => {
    await draft(alice, bob);
    await publish();
    await draft(bob);
    await publish();
    expect(await notices(alice)).toEqual([
      { subject: "Votre planning a été publié", body: "", email_status: "pending", pushes: 1 },
      {
        subject: "Planning modifié — garde de nuit du 01/11/2099",
        body: "Vous n'êtes plus attendu sur cette garde : la nouvelle version du planning ne vous y affecte plus.",
        email_status: "pending",
        pushes: 1,
      },
    ]);
    // Bob reste, et n'apprend rien de plus que la nouvelle version.
    expect((await notices(bob)).map(n => n.subject)).toEqual([
      "Votre planning a été publié",
      "Votre planning a été publié",
    ]);
  });

  it("ne retire personne à la première publication", async () => {
    await draft(alice);
    await draft(bob);
    await publish();
    expect(await notices(alice)).toEqual([]);
  });

  it("ne répète pas à l’agent dont le désistement a été accepté ce que la réponse lui a dit", async () => {
    await draft(alice);
    await publish();
    await be(alice);
    await live.query(
      "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,'Convocation')",
      [org, shift, alice],
    );
    await be(manager);
    await live.query("update public.shift_withdrawals set state='ACCEPTED' where user_id=$1", [alice]);
    await draft(bob);
    await publish();
    expect((await notices(alice)).map(n => n.subject)).toEqual(["Votre planning a été publié"]);
  });

  it("n’écrit pas à un agent sorti de l’effectif", async () => {
    await draft(alice);
    await publish();
    await live.exec("reset role");
    await live.query("update public.memberships set active=false where user_id=$1", [alice]);
    await draft(bob);
    await publish();
    expect((await notices(alice)).map(n => n.subject)).toEqual(["Votre planning a été publié"]);
  });
});

describe("Bilan du 27 septembre — la fiche d’un agent parti dans un autre centre", () => {
  const orgA = "10000000-0000-0000-0000-0000000000d5";
  const orgB = "10000000-0000-0000-0000-0000000000d6";
  const teamA = "20000000-0000-0000-0000-0000000000d5";
  const teamB = "20000000-0000-0000-0000-0000000000d6";
  const adminA = "30000000-0000-0000-0000-0000000000d5";
  const adminB = "30000000-0000-0000-0000-0000000000d6";
  const mover = "30000000-0000-0000-0000-0000000000d7";
  const leaver = "30000000-0000-0000-0000-0000000000d8";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const rename = (user: string, name: string) =>
    live.query("update public.profiles set display_name=$2 where user_id=$1 returning user_id", [user, name]);
  const nameOf = async (user: string) => {
    await live.exec("reset role");
    return (
      await live.query<{ display_name: string }>("select display_name from public.profiles where user_id=$1", [user])
    ).rows[0].display_name;
  };

  beforeEach(async () => {
    live = await freshDatabase();
    // L'agent quitte A pour B : son rattachement à A est désactivé, celui à B
    // actif. Un second agent quitte A sans aller nulle part.
    await live.exec(`
      insert into auth.users(id) values ('${adminA}'), ('${adminB}'), ('${mover}'), ('${leaver}');
      insert into public.profiles(user_id,display_name) values
        ('${adminA}','Admin A'), ('${adminB}','Admin B'), ('${mover}','Agent Mobile'), ('${leaver}','Agent Parti');
      insert into public.organizations(id,name) values ('${orgA}','Centre A'), ('${orgB}','Centre B');
      insert into public.teams(id,organization_id,name) values ('${teamA}','${orgA}','Alpha'), ('${teamB}','${orgB}','Bravo');
      insert into public.memberships values
        ('${orgA}','${adminA}','${teamA}','ADMIN',true),
        ('${orgB}','${adminB}','${teamB}','ADMIN',true),
        ('${orgA}','${mover}','${teamA}','AGENT',false),
        ('${orgB}','${mover}','${teamB}','AGENT',true),
        ('${orgA}','${leaver}','${teamA}','AGENT',false);`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("refuse à l’ancien centre de modifier la fiche d’un agent désormais actif ailleurs", async () => {
    await be(adminA);
    expect((await rename(mover, "Renommé par A")).rows).toEqual([]);
    expect(await nameOf(mover)).toBe("Agent Mobile");
    // Pas davantage par la fiche d'agent atomique : rien n'est écrit, pas même
    // le rattachement à A.
    await be(adminA);
    await expect(
      live.query("select public.save_member($1,$2,$3,'AGENT',false,'Renommé par A',null,null,null,'0600000000',$4)", [
        orgA,
        mover,
        teamA,
        [],
      ]),
    ).rejects.toThrow("Not allowed to edit this member");
    expect(await nameOf(mover)).toBe("Agent Mobile");
  });

  it("laisse le centre où il est actif la modifier", async () => {
    await be(adminB);
    expect((await rename(mover, "Renommé par B")).rows).toEqual([{ user_id: mover }]);
    expect(await nameOf(mover)).toBe("Renommé par B");
  });

  it("laisse l’ancien centre modifier et réactiver un agent qui n’est actif nulle part", async () => {
    await be(adminA);
    expect((await rename(leaver, "Agent Revenu")).rows).toEqual([{ user_id: leaver }]);
    await live.query("select public.save_member($1,$2,$3,'AGENT',true,'Agent Revenu',null,null,null,null,$4)", [
      orgA,
      leaver,
      teamA,
      [],
    ]);
    await live.exec("reset role");
    expect(
      (
        await live.query("select active from public.memberships where user_id=$1 and organization_id=$2", [
          leaver,
          orgA,
        ])
      ).rows,
    ).toEqual([{ active: true }]);
  });

  it("laisse l’ancien centre lire son nom, pour les gardes qu’il a tenues chez lui", async () => {
    await be(adminA);
    expect((await live.query("select display_name from public.profiles where user_id=$1", [mover])).rows).toEqual([
      { display_name: "Agent Mobile" },
    ]);
  });
});

describe("Bilan du 27 septembre — une clé par email, que Resend reconnaît", () => {
  const org = "10000000-0000-0000-0000-0000000000d9";
  const team = "20000000-0000-0000-0000-0000000000d9";
  const agent = "30000000-0000-0000-0000-0000000000d9";
  let live: PGlite;
  type Job = { id: string; lease: string; idempotency_key: string };
  const claim = async () => {
    await live.exec("reset role");
    await live.exec("set role service_role");
    return (await live.query<Job>("select id, lease, idempotency_key from public.claim_email_deliveries(10)")).rows;
  };
  const finish = async (job: Job, status: number) => {
    await live.exec("reset role");
    await live.exec("set role service_role");
    await live.query("select public.finish_email_delivery($1,$2,$3)", [job.id, job.lease, status]);
  };
  const state = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ email_status: string; email_key: string }>(
        "select email_status, email_key from public.notifications",
      )
    ).rows[0];
  };
  // Le délai qui suit un échec, ou le bail d'un passage interrompu, sans attendre.
  const later = async () => {
    await live.exec("reset role");
    await live.query("update public.notifications set email_available_at=now()");
  };

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id,email) values ('${agent}','agent@d9.test');
      insert into public.profiles(user_id,display_name) values ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre D9');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${agent}','${team}','AGENT',true);
      insert into public.notifications(organization_id,user_id,kind,subject) values ('${org}','${agent}','CAMPAIGN_OPENED','Ouverte');`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("rend la même clé au passage qui reprend un bail expiré, et ignore le premier", async () => {
    const [first] = await claim();
    expect(first.idempotency_key).toBeTruthy();
    // Le premier passage dépasse son bail : un second reprend le message.
    await later();
    const [second] = await claim();
    expect(second.id).toBe(first.id);
    expect(second.lease).not.toBe(first.lease);
    // Même clé : si le premier a bien envoyé, Resend ne renverra pas.
    expect(second.idempotency_key).toBe(first.idempotency_key);
    await finish(first, 200);
    expect((await state()).email_status).toBe("sending");
    await finish(second, 200);
    expect((await state()).email_status).toBe("sent");
  });

  it("garde la clé quand on ignore si le message est parti", async () => {
    const [job] = await claim();
    await finish(job, 0);
    await later();
    const [retry] = await claim();
    expect(retry.idempotency_key).toBe(job.idempotency_key);
  });

  it.each([500, 503, 429, 409])("change de clé quand Resend répond %i, et réessaie", async status => {
    const [job] = await claim();
    await finish(job, status);
    const after = await state();
    expect(after.email_status).toBe("pending");
    expect(after.email_key).not.toBe(job.idempotency_key);
    await later();
    const [retry] = await claim();
    expect(retry.idempotency_key).toBe(after.email_key);
  });

  it("abandonne toujours sur un refus définitif", async () => {
    const [job] = await claim();
    await finish(job, 422);
    expect((await state()).email_status).toBe("failed");
  });

  it("n’est réservable que par le serveur, pas même par anon", async () => {
    await live.exec("reset role");
    expect(
      (
        await live.query<{ anon: boolean; authenticated: boolean; server: boolean }>(
          `select has_function_privilege('anon', 'public.claim_email_deliveries(integer)', 'execute') as anon,
                  has_function_privilege('authenticated', 'public.claim_email_deliveries(integer)', 'execute') as authenticated,
                  has_function_privilege('service_role', 'public.claim_email_deliveries(integer)', 'execute') as server`,
        )
      ).rows,
    ).toEqual([{ anon: false, authenticated: false, server: true }]);
  });
});

describe("Migration 20260927090000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20260927090000_correctifs_bilan.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20260925180000_correctifs_mineurs.sql");
    await early.close();
  }, 90000);

  it("donne sa propre clé à chaque notification déjà en base", async () => {
    const org = "10000000-0000-0000-0000-0000000000da";
    const team = "20000000-0000-0000-0000-0000000000da";
    const agent = "30000000-0000-0000-0000-0000000000da";
    const db = await upTo(target);
    await db.exec(`
      insert into auth.users(id) values ('${agent}');
      insert into public.profiles(user_id,display_name) values ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre DA');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${agent}','${team}','AGENT',true);
      insert into public.notifications(organization_id,user_id,kind,subject) values
        ('${org}','${agent}','CAMPAIGN_OPENED','Ouverte'), ('${org}','${agent}','CAMPAIGN_REMINDER','Rappel');`);
    await db.exec(migration());
    const keys = (await db.query<{ k: string }>("select email_key as k from public.notifications")).rows;
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map(row => row.k)).size).toBe(2);
    await db.close();
  }, 90000);
});

// Analyse du 5 octobre : chaque parcours ci-dessous échouait sur le schéma de
// 20260927090000 (.local/audit-20261005/sql/constats.test.ts › F1 et F2).
describe("Analyse du 5 octobre — seul un administrateur rend ses droits à un administrateur", () => {
  const org = "10000000-0000-0000-0000-0000000000e0";
  const team = "20000000-0000-0000-0000-0000000000e0";
  const admin = "30000000-0000-0000-0000-0000000000e0";
  const former = "30000000-0000-0000-0000-0000000000e1";
  const manager = "30000000-0000-0000-0000-0000000000e2";
  const agent = "30000000-0000-0000-0000-0000000000e3";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const save = (member: string, role: string, active: boolean, name: string) =>
    live.query("select public.save_member($1,$2,$3,$4,$5,$6,null,null,null,null,$7)", [
      org,
      member,
      team,
      role,
      active,
      name,
      [],
    ]);
  const state = async (member: string) => {
    await be(null);
    return (
      await live.query<{ role: string; active: boolean; display_name: string }>(
        `select m.role, m.active, p.display_name from public.memberships m
           join public.profiles p on p.user_id = m.user_id where m.user_id = $1`,
        [member],
      )
    ).rows[0];
  };

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${admin}','admin@e0.test',now()), ('${former}','ancien-admin@e0.test',now()),
        ('${manager}','chef@e0.test',now()), ('${agent}','agent@e0.test',now());
      insert into public.profiles(user_id,display_name) values
        ('${admin}','Administratrice'), ('${former}','Ancien Admin'), ('${manager}','Gestionnaire'), ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre E0');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${admin}','${team}','ADMIN',true),
        ('${org}','${former}','${team}','ADMIN',false),
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',false);`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("refuse à un gestionnaire de réactiver un administrateur, par la fiche comme directement", async () => {
    await be(manager);
    await expect(save(former, "ADMIN", true, "Ancien Admin")).rejects.toThrow(
      "Only an administrator can reactivate an administrator",
    );
    await be(manager);
    await expect(
      live.query("update public.memberships set active=true where organization_id=$1 and user_id=$2", [org, former]),
    ).rejects.toThrow("Only an administrator can reactivate an administrator");
    expect(await state(former)).toEqual({ role: "ADMIN", active: false, display_name: "Ancien Admin" });
  });

  it("laisse un administrateur le réactiver", async () => {
    await be(admin);
    await save(former, "ADMIN", true, "Ancien Admin");
    expect(await state(former)).toMatchObject({ role: "ADMIN", active: true });
  });

  it("laisse un gestionnaire réactiver un agent, et corriger la fiche d’un administrateur sans le réactiver", async () => {
    await be(manager);
    await save(agent, "AGENT", true, "Agent");
    expect(await state(agent)).toMatchObject({ role: "AGENT", active: true });
    await be(manager);
    await save(former, "ADMIN", false, "Ancien Admin, nom corrigé");
    expect(await state(former)).toEqual({ role: "ADMIN", active: false, display_name: "Ancien Admin, nom corrigé" });
  });

  it("laisse un administrateur réinviter un administrateur désactivé, rattaché aussitôt", async () => {
    await be(admin);
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
       values ($1,$2,'ancien-admin@e0.test','Ancien Admin','ADMIN',$3)`,
      [org, team, admin],
    );
    expect(await state(former)).toMatchObject({ role: "ADMIN", active: true });
  });
});

describe("Analyse du 5 octobre — déverrouiller une campagne inscrit les arrivées du verrou", () => {
  const org = "10000000-0000-0000-0000-0000000000e1";
  const team = "20000000-0000-0000-0000-0000000000e1";
  const manager = "30000000-0000-0000-0000-0000000000e4";
  const veteran = "30000000-0000-0000-0000-0000000000e5";
  const newcomer = "30000000-0000-0000-0000-0000000000e6";
  const campaign = "40000000-0000-0000-0000-0000000000e1";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const lock = async (locked: boolean) => {
    await be(manager);
    await live.query("update public.availability_campaigns set locked=$2 where id=$1", [campaign, locked]);
  };
  const participants = async () => {
    await be(null);
    return (
      await live.query<{ user_id: string }>(
        "select user_id from public.campaign_participants where campaign_id=$1 order by user_id",
        [campaign],
      )
    ).rows.map(row => row.user_id);
  };
  const opened = async (user: string) => {
    await be(null);
    return Number(
      (
        await live.query<{ n: string }>(
          "select count(*)::text n from public.notifications where user_id=$1 and kind='CAMPAIGN_OPENED'",
          [user],
        )
      ).rows[0].n,
    );
  };

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${manager}'), ('${veteran}'), ('${newcomer}');
      insert into public.profiles(user_id,display_name) values ('${manager}','Chef'), ('${veteran}','Ancien'), ('${newcomer}','Nouveau');
      insert into public.organizations(id,name) values ('${org}','Centre E1');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${veteran}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2099-11-01','2099-11-30',now()-interval '1 day',now()+interval '10 days');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${campaign}','${manager}'), ('${org}','${campaign}','${veteran}');`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("inscrit et prévient au déverrouillage l’agent rattaché pendant le verrou, et lui seul", async () => {
    await lock(true);
    await be(null);
    await live.query("insert into public.memberships values ($1,$2,$3,'AGENT',true)", [org, newcomer, team]);
    expect(await participants()).not.toContain(newcomer);
    await lock(false);
    expect(await participants()).toEqual([manager, veteran, newcomer].sort());
    expect(await opened(newcomer)).toBe(1);
    // Les inscrits de toujours ne sont pas prévenus une seconde fois.
    expect(await opened(veteran)).toBe(1);
    // Et l'arrivant peut répondre.
    await be(newcomer);
    await live.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2099-11-01','DAY')",
      [campaign, newcomer],
    );
  });

  it("ne réécrit rien quand on verrouille et déverrouille de nouveau", async () => {
    await lock(true);
    await be(null);
    await live.query("insert into public.memberships values ($1,$2,$3,'AGENT',true)", [org, newcomer, team]);
    await lock(false);
    await lock(true);
    await lock(false);
    expect(await opened(newcomer)).toBe(1);
    expect(await participants()).toHaveLength(3);
  });

  it("n’inscrit personne au déverrouillage d’une campagne dont la clôture est passée", async () => {
    await lock(true);
    await be(null);
    await live.query("update public.availability_campaigns set closes_at=now()-interval '1 hour' where id=$1", [
      campaign,
    ]);
    await live.query("insert into public.memberships values ($1,$2,$3,'AGENT',true)", [org, newcomer, team]);
    await live.query("update public.availability_campaigns set locked=false where id=$1", [campaign]);
    expect(await participants()).not.toContain(newcomer);
    expect(await opened(newcomer)).toBe(0);
  });

  it("n’inscrit pas un membre désactivé ni celui d’une autre équipe", async () => {
    const other = "20000000-0000-0000-0000-0000000000e2";
    await lock(true);
    await be(null);
    await live.query("insert into public.teams(id,organization_id,name) values ($1,$2,'Bravo')", [other, org]);
    await live.query("insert into public.memberships values ($1,$2,$3,'AGENT',true)", [org, newcomer, other]);
    await live.query("update public.memberships set active=false where user_id=$1", [veteran]);
    await live.query("delete from public.campaign_participants where user_id=$1", [veteran]);
    await lock(false);
    expect(await participants()).toEqual([manager]);
  });
});

describe("Migration 20261005090000 — gardes d’application et rattrapage", () => {
  const target = MIGRATIONS.indexOf("20261005090000_reactivation_admin_deverrouillage.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20260927090000_correctifs_bilan.sql");
    await early.close();
  }, 90000);

  it("inscrit et prévient à l’application l’agent arrivé pendant un verrou déjà levé", async () => {
    const org = "10000000-0000-0000-0000-0000000000e3";
    const team = "20000000-0000-0000-0000-0000000000e3";
    const agent = "30000000-0000-0000-0000-0000000000e7";
    const campaign = "40000000-0000-0000-0000-0000000000e3";
    const db = await upTo(target);
    await db.exec(`
      insert into auth.users(id) values ('${agent}');
      insert into public.profiles(user_id,display_name) values ('${agent}','Arrivé pendant le verrou');
      insert into public.organizations(id,name) values ('${org}','Centre E3');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at,locked)
        values ('${campaign}','${org}','${team}','Novembre','2099-11-01','2099-11-30',now()-interval '1 day',now()+interval '10 days',true);
      insert into public.memberships values ('${org}','${agent}','${team}','AGENT',true);
      update public.availability_campaigns set locked=false where id='${campaign}';`);
    // Le défaut, sur le schéma d'avant : déverrouillée, la campagne l'ignore.
    expect((await db.query("select 1 from public.campaign_participants where user_id=$1", [agent])).rows).toEqual([]);
    await db.exec(migration());
    expect(
      (await db.query("select campaign_id from public.campaign_participants where user_id=$1", [agent])).rows,
    ).toEqual([{ campaign_id: campaign }]);
    expect(
      (
        await db.query("select count(*)::int n from public.notifications where user_id=$1 and kind='CAMPAIGN_OPENED'", [
          agent,
        ])
      ).rows,
    ).toEqual([{ n: 1 }]);
    await db.close();
  }, 90000);
});

// Analyse du 5 octobre, C3 : un refus qui vise le compte Resend ne solde plus
// la file. Le serveur rend les messages réservés, sans compter la tentative.
describe("Analyse du 5 octobre — une file d’emails suspendue rend ses messages", () => {
  const org = "10000000-0000-0000-0000-0000000000e4";
  const team = "20000000-0000-0000-0000-0000000000e4";
  const agent = "30000000-0000-0000-0000-0000000000e8";
  let live: PGlite;
  type Job = { id: string; lease: string; idempotency_key: string };
  const server = async () => {
    await live.exec("reset role");
    await live.exec("set role service_role");
  };
  const claim = async () => {
    await server();
    return (await live.query<Job>("select id, lease, idempotency_key from public.claim_email_deliveries(10)")).rows;
  };
  const release = async (job: Job, retryIn: number, status?: number) => {
    await server();
    await live.query("select public.release_email_delivery($1,$2,$3,$4)", [job.id, job.lease, retryIn, status ?? null]);
  };
  const row = async (id: string) => {
    await live.exec("reset role");
    return (
      await live.query<{
        email_status: string;
        email_attempts: number;
        email_last_status: number | null;
        email_key: string;
        lease: string | null;
        waits: number;
      }>(
        `select email_status, email_attempts, email_last_status, email_key, email_lease as lease,
                round(extract(epoch from email_available_at - now()))::int as waits
           from public.notifications where id = $1`,
        [id],
      )
    ).rows[0];
  };
  const again = async () => {
    await live.exec("reset role");
    await live.query("update public.notifications set email_available_at = now()");
  };

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id,email) values ('${agent}','agent@e4.test');
      insert into public.profiles(user_id,display_name) values ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre E4');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${agent}','${team}','AGENT',true);
      insert into public.notifications(organization_id,user_id,kind,subject) values
        ('${org}','${agent}','CAMPAIGN_OPENED','Ouverte'), ('${org}','${agent}','CAMPAIGN_REMINDER','Rappel');`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("rend en file le message que Resend a refusé pour le compte, sans compter la tentative, avec une clé neuve", async () => {
    const [job] = await claim();
    expect((await row(job.id)).email_attempts).toBe(1);
    await release(job, 900, 403);
    const after = await row(job.id);
    expect(after).toMatchObject({ email_status: "pending", email_attempts: 0, email_last_status: 403, lease: null });
    expect(after.email_key).not.toBe(job.idempotency_key);
    expect(after.waits).toBeGreaterThan(890);
    // Le délai tient : un passage immédiat ne le reprend pas.
    expect((await claim()).map(j => j.id)).not.toContain(job.id);
  });

  it("rend un message du lot qui n’a pas été tenté, avec sa clé et son dernier état", async () => {
    const [, untried] = await claim();
    await release(untried, 900);
    const after = await row(untried.id);
    expect(after).toMatchObject({ email_status: "pending", email_attempts: 0, email_last_status: null });
    expect(after.email_key).toBe(untried.idempotency_key);
  });

  it("ne l’abandonne jamais pour une suspension, même répétée", async () => {
    let id = "";
    for (let i = 0; i < 7; i++) {
      await again();
      const [job] = await claim();
      id = job.id;
      await release(job, 60, 429);
    }
    expect(await row(id)).toMatchObject({ email_status: "pending", email_attempts: 0 });
  });

  it("le passe en échec au-delà de trois jours : l’avis a perdu son objet", async () => {
    await live.exec("reset role");
    await live.query(
      "update public.notifications set created_at = now() - interval '4 days' where subject = 'Ouverte'",
    );
    const jobs = await claim();
    for (const job of jobs) await release(job, 900, 403);
    await live.exec("reset role");
    expect(
      (
        await live.query<{ subject: string; email_status: string }>(
          "select subject, email_status from public.notifications order by subject",
        )
      ).rows,
    ).toEqual([
      { subject: "Ouverte", email_status: "failed" },
      { subject: "Rappel", email_status: "pending" },
    ]);
  });

  it("ne rend rien sous un mauvais jeton", async () => {
    const [job] = await claim();
    await release({ ...job, lease: "00000000-0000-0000-0000-000000000000" }, 900, 403);
    expect(await row(job.id)).toMatchObject({ email_status: "sending", email_attempts: 1 });
  });

  it("n’est appelable que par le serveur", async () => {
    await live.exec("reset role");
    expect(
      (
        await live.query<{ anon: boolean; authenticated: boolean; server: boolean }>(
          `select has_function_privilege('anon', 'public.release_email_delivery(uuid,uuid,integer,integer)', 'execute') as anon,
                  has_function_privilege('authenticated', 'public.release_email_delivery(uuid,uuid,integer,integer)', 'execute') as authenticated,
                  has_function_privilege('service_role', 'public.release_email_delivery(uuid,uuid,integer,integer)', 'execute') as server`,
        )
      ).rows,
    ).toEqual([{ anon: false, authenticated: false, server: true }]);
  });
});

describe("Migration 20261005120000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261005120000_suspension_file_email.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261005090000_reactivation_admin_deverrouillage.sql");
    await early.close();
  }, 90000);
});

// La conduite (7 octobre) : saisie à l'invitation, une seule par agent, et
// exigible dans les besoins d'une garde comme toute qualification.
describe("Conduite — saisie à l’invitation, une seule, exigible", () => {
  const org = "10000000-0000-0000-0000-0000000000e5";
  const team = "20000000-0000-0000-0000-0000000000e5";
  const manager = "30000000-0000-0000-0000-0000000000e9";
  const existing = "30000000-0000-0000-0000-0000000000ea";
  const returning = "30000000-0000-0000-0000-0000000000eb";
  const newcomer = "30000000-0000-0000-0000-0000000000ec";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const invite = async (email: string, conduite: string | null) => {
    await be(manager);
    await live.query(
      `insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by,conduite)
       values ($1,$2,$3,'Invité','AGENT',$4,$5)`,
      [org, team, email, manager, conduite],
    );
  };
  const held = async (user: string) => {
    await be(null);
    return (
      await live.query<{ name: string }>(
        `select q.name from public.user_qualifications uq join public.qualifications q on q.id = uq.qualification_id
          where uq.user_id = $1 order by q.name`,
        [user],
      )
    ).rows.map(row => row.name);
  };
  const save = (member: string, qualifications: string[]) =>
    live.query("select public.save_member($1,$2,$3,'AGENT',true,'Agent',null,null,null,null,$4)", [
      org,
      member,
      team,
      qualifications,
    ]);

  beforeEach(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${manager}','chef@e5.test',now()), ('${existing}','existant@e5.test',now()),
        ('${returning}','retour@e5.test',now());
      insert into public.profiles(user_id,display_name) values
        ('${manager}','Chef'), ('${existing}','Existant'), ('${returning}','De retour');
      insert into public.organizations(id,name) values ('${org}','Centre E5');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${returning}','${team}','AGENT',false);
      insert into public.qualifications(organization_id,name) values ('${org}','PL'), ('${org}','SAP');
      insert into public.user_qualifications(organization_id,user_id,qualification_id)
        select '${org}', '${returning}', id from public.qualifications where organization_id='${org}' and name in ('PL','SAP');`);
  }, 30000);
  afterEach(async () => {
    await live.close();
  });

  it("la donne au compte neuf quand il confirme son adresse, et l’ajoute au catalogue", async () => {
    await invite("nouveau@e5.test", "COD2");
    await be(null);
    await live.query("insert into auth.users(id,email,email_confirmed_at) values ($1,'nouveau@e5.test',now())", [
      newcomer,
    ]);
    expect(await held(newcomer)).toEqual(["COD2"]);
    expect(
      (await live.query("select 1 from public.qualifications where organization_id=$1 and name='COD2'", [org])).rows,
    ).toHaveLength(1);
  });

  it("la donne aussitôt au compte déjà confirmé, rattaché à l’invitation", async () => {
    await invite("existant@e5.test", "PL");
    expect(await held(existing)).toEqual(["PL"]);
  });

  it("remplace à la réinvitation la conduite d’un agent qui revient, sans toucher au reste", async () => {
    await invite("retour@e5.test", "COD6");
    expect(await held(returning)).toEqual(["COD6", "SAP"]);
  });

  it("ne donne rien et ne retire rien pour « Aucun »", async () => {
    await invite("retour@e5.test", null);
    expect(await held(returning)).toEqual(["PL", "SAP"]);
    await invite("existant@e5.test", null);
    expect(await held(existing)).toEqual([]);
  });

  it("refuse une conduite hors de la liste", async () => {
    await expect(invite("existant@e5.test", "COD9")).rejects.toThrow("invitations_conduite_check");
  });

  it("refuse une seconde conduite, et laisse passer de l’une à l’autre d’un même geste", async () => {
    await be(manager);
    await expect(save(returning, ["PL", "COD2", "SAP"])).rejects.toThrow("Only one driving qualification per agent");
    expect(await held(returning)).toEqual(["PL", "SAP"]);
    await be(manager);
    await save(returning, ["COD2", "SAP"]);
    expect(await held(returning)).toEqual(["COD2", "SAP"]);
    // Pas davantage par l'éditeur SQL.
    await be(null);
    await expect(
      live.query(
        `insert into public.user_qualifications(organization_id,user_id,qualification_id)
         select $1, $2, id from public.qualifications where organization_id=$1 and name='PL'`,
        [org, returning],
      ),
    ).rejects.toThrow("Only one driving qualification per agent");
  });

  it("s’exige dans les besoins d’une garde, et la publication la compte", async () => {
    const campaign = "40000000-0000-0000-0000-0000000000e5";
    const schedule = "60000000-0000-0000-0000-0000000000e5";
    const shift = "70000000-0000-0000-0000-0000000000e5";
    await be(null);
    await live.query("update public.memberships set active=true where user_id=$1", [returning]);
    await live.exec(`
      insert into public.memberships values ('${org}','${existing}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2099-11-01','2099-11-01',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${campaign}','${existing}'), ('${org}','${campaign}','${returning}')
        on conflict do nothing;
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        values ('${shift}','${org}','${schedule}','2099-11-01','DAY');`);
    for (const agent of [existing, returning]) {
      await be(agent);
      await live.query(
        "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2099-11-01','DAY')",
        [campaign, agent],
      );
      await live.query(
        "update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2",
        [campaign, agent],
      );
    }
    await be(manager);
    await live.query("select public.set_staffing_requirement($1,'2099-11-01','DAY',1,$2)", [
      campaign,
      JSON.stringify({ COD2: 1 }),
    ]);
    const assign = (user: string) =>
      live.query(
        "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
        [org, shift, user, manager],
      );
    // Sans COD2 au brouillon : refusé, et la base nomme ce qui manque.
    await assign(existing);
    await expect(live.query("select private.publish_schedule_shift($1)", [shift])).rejects.toThrow(
      "Qualifications not covered: COD2",
    );
    // L'agent qui la tient : publié.
    await be(manager);
    await live.query("delete from public.schedule_assignments where schedule_shift_id=$1 and revision=0", [shift]);
    await save(returning, ["COD2", "SAP"]);
    await assign(returning);
    expect((await live.query<{ r: number }>("select private.publish_schedule_shift($1) as r", [shift])).rows).toEqual([
      { r: 1 },
    ]);
  });
});

describe("Migration 20261007090000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261007090000_conduite.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261005120000_suspension_file_email.sql");
    await early.close();
  }, 90000);
});

// Audit de performance du 7 octobre : une fonction « security definer » appelée
// dans une règle l'est pour chaque ligne examinée — vingt secondes par écran
// d'encadrement sur un centre de taille réelle. Les règles testent désormais
// l'appartenance à un ensemble calculé une fois par requête. Les droits, eux,
// ne changent pas : tout ce fichier les vérifie à travers les règles réécrites.
describe("Droits lus par ensemble — une fois par requête, plus une fois par ligne", () => {
  const org = "10000000-0000-0000-0000-0000000000f1";
  const other = "10000000-0000-0000-0000-0000000000f2";
  const team = "20000000-0000-0000-0000-0000000000f1";
  const otherTeam = "20000000-0000-0000-0000-0000000000f2";
  const agent = "30000000-0000-0000-0000-0000000000f1";
  const manager = "30000000-0000-0000-0000-0000000000f2";
  const admin = "30000000-0000-0000-0000-0000000000f3";
  const otherAdmin = "30000000-0000-0000-0000-0000000000f4";
  const former = "30000000-0000-0000-0000-0000000000f5";
  let live: PGlite;
  const sets = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await live.exec("set role authenticated");
    const read = async (fn: string) =>
      (await live.query<{ id: string }>(`select id from private.${fn}() id order by 1`)).rows.map(row => row.id);
    return { member: await read("my_organizations"), managed: await read("managed_organizations") };
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${agent}'), ('${manager}'), ('${admin}'), ('${otherAdmin}'), ('${former}');
      insert into public.profiles(user_id,display_name) values
        ('${agent}','Agent'), ('${manager}','Chef'), ('${admin}','Admin'), ('${otherAdmin}','Admin F2'), ('${former}','Parti');
      insert into public.organizations(id,name) values ('${org}','Centre F1'), ('${other}','Centre F2');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha'), ('${otherTeam}','${other}','Bravo');
      insert into public.memberships values
        ('${org}','${agent}','${team}','AGENT',true),
        ('${org}','${manager}','${team}','GESTIONNAIRE',true),
        ('${org}','${admin}','${team}','ADMIN',true),
        ('${other}','${otherAdmin}','${otherTeam}','ADMIN',true),
        ('${org}','${former}','${team}','GESTIONNAIRE',false);`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("aucune règle n’appelle plus is_member, can_manage ou can_administer", async () => {
    // Une règle ajoutée par copie d'une ancienne réintroduirait le coût sans que
    // rien d'autre ne le signale : les droits resteraient justes, seulement lents.
    await live.exec("reset role");
    const { rows } = await live.query<{ policy: string }>(
      `select tablename || '.' || policyname as policy from pg_policies
        where schemaname = 'public'
          and coalesce(qual, '') || coalesce(with_check, '') ~ 'private[.](is_member|can_manage|can_administer)[(]'`,
    );
    expect(rows).toEqual([]);
  });

  it("rend les centres du membre actif, et ceux où il encadre", async () => {
    expect(await sets(agent)).toEqual({ member: [org], managed: [] });
    expect(await sets(manager)).toEqual({ member: [org], managed: [org] });
    expect(await sets(admin)).toEqual({ member: [org], managed: [org] });
    expect(await sets(otherAdmin)).toEqual({ member: [other], managed: [other] });
    // Désactivé : plus rien, même avec un rôle d'encadrement.
    expect(await sets(former)).toEqual({ member: [], managed: [] });
    // Sans session : rien, et les règles refusent.
    expect(await sets(null)).toEqual({ member: [], managed: [] });
  });

  it("n’est pas ouverte aux visiteurs sans compte", async () => {
    await live.exec("reset role");
    await live.exec("set role anon");
    await expect(live.query("select private.my_organizations()")).rejects.toThrow();
    await expect(live.query("select private.managed_organizations()")).rejects.toThrow();
    await live.exec("reset role");
  });

  it("garde les règles telles qu’elles étaient : l’encadrement d’un centre ne lit pas l’autre", async () => {
    await sets(otherAdmin);
    expect((await live.query("select id from public.teams order by id")).rows).toEqual([{ id: otherTeam }]);
    expect((await live.query("select user_id from public.memberships")).rows).toEqual([{ user_id: otherAdmin }]);
    await sets(agent);
    // L'agent ne lit que sa propre appartenance ; le gestionnaire, tout son centre.
    expect((await live.query("select user_id from public.memberships")).rows).toEqual([{ user_id: agent }]);
    await sets(manager);
    expect((await live.query("select user_id from public.memberships")).rows).toHaveLength(4);
  });
});

describe("Migration 20261007150000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261007150000_droits_par_ensemble.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261007090000_conduite.sql");
    await early.close();
  }, 90000);
});

// Décision C6 (16 octobre) : l'encadrement — gestionnaires et administrateurs —
// ne prend pas de garde, il gère les effectifs. Seuls les agents sont inscrits
// aux campagnes, par chacun des chemins d'inscription, et seuls eux sont relancés.
describe("Encadrement hors des campagnes — seuls les agents prennent des gardes", () => {
  const org = "10000000-0000-0000-0000-0000000000c6";
  const team = "20000000-0000-0000-0000-0000000000c6";
  const admin = "30000000-0000-0000-0000-0000000000c1";
  const chef = "30000000-0000-0000-0000-0000000000c2";
  const agent = "30000000-0000-0000-0000-0000000000c3";
  const promoted = "30000000-0000-0000-0000-0000000000c4";
  const demoted = "30000000-0000-0000-0000-0000000000c5";
  const newChef = "30000000-0000-0000-0000-0000000000c6";
  const newAgent = "30000000-0000-0000-0000-0000000000c7";
  const open = "40000000-0000-0000-0000-0000000000c1";
  const locked = "40000000-0000-0000-0000-0000000000c2";
  let live: PGlite;
  const be = async (id: string | null) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    if (id) await live.exec("set role authenticated");
  };
  const participants = async (campaign: string) => {
    await be(null);
    return (
      await live.query<{ user_id: string }>(
        "select user_id from public.campaign_participants where campaign_id=$1 order by user_id",
        [campaign],
      )
    ).rows.map(row => row.user_id);
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${admin}'), ('${chef}'), ('${agent}'), ('${promoted}'), ('${demoted}'),
        ('${newChef}'), ('${newAgent}');
      insert into public.profiles(user_id,display_name) values ('${admin}','Admin'), ('${chef}','Chef'),
        ('${agent}','Agent'), ('${promoted}','Promu'), ('${demoted}','De retour'), ('${newChef}','Nouveau chef'),
        ('${newAgent}','Nouvel agent');
      insert into public.organizations(id,name) values ('${org}','Centre C6');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${admin}','${team}','ADMIN',true),
        ('${org}','${chef}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('${org}','${promoted}','${team}','AGENT',true),
        ('${org}','${demoted}','${team}','GESTIONNAIRE',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at,locked) values
        ('${open}','${org}','${team}','Octobre C6','2026-10-01','2026-10-01',now()-interval '1 day',now()+interval '9 days',false),
        ('${locked}','${org}','${team}','Novembre C6','2026-11-01','2026-11-01',now()-interval '1 day',now()+interval '9 days',true);
      -- L'état d'avant la décision : l'encadrement inscrit comme les agents.
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${open}','${chef}'), ('${org}','${open}','${agent}'), ('${org}','${open}','${promoted}');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("n’inscrit que les agents à la création d’une campagne, administrateur et gestionnaire exclus", async () => {
    await be(chef);
    const created = await live.query<{ id: string }>("select public.create_campaign($1,$2,$3,$4,$5) as id", [
      org,
      team,
      "Décembre C6",
      "2096-12-01",
      "2096-11-20",
    ]);
    expect(await participants(created.rows[0].id)).toEqual([agent, promoted].sort());
  });

  it("n’inscrit pas l’encadrement qui arrive en cours de campagne, mais l’agent si", async () => {
    await be(null);
    await live.exec(`insert into public.memberships values
      ('${org}','${newChef}','${team}','GESTIONNAIRE',true), ('${org}','${newAgent}','${team}','AGENT',true);`);
    const enrolled = await participants(open);
    expect(enrolled).toContain(newAgent);
    expect(enrolled).not.toContain(newChef);
  });

  it("fait rejoindre les campagnes ouvertes à qui redevient agent", async () => {
    expect(await participants(open)).not.toContain(demoted);
    await be(admin);
    await live.query("update public.memberships set role='AGENT' where organization_id=$1 and user_id=$2", [
      org,
      demoted,
    ]);
    expect(await participants(open)).toContain(demoted);
    // La verrouillée attend son déverrouillage, comme pour un arrivant.
    expect(await participants(locked)).not.toContain(demoted);
  });

  it("garde inscrit l’agent passé à l’encadrement, sans rien effacer, mais ne le relance plus", async () => {
    await be(promoted);
    await live.query(
      "insert into public.availability_entries(campaign_id,user_id,date,availability_type) values ($1,$2,'2026-10-01','DAY')",
      [open, promoted],
    );
    await be(admin);
    await live.query("update public.memberships set role='GESTIONNAIRE' where organization_id=$1 and user_id=$2", [
      org,
      promoted,
    ]);
    expect(await participants(open)).toContain(promoted);
    await be(null);
    expect(
      (
        await live.query("select 1 from public.availability_entries where campaign_id=$1 and user_id=$2", [
          open,
          promoted,
        ])
      ).rows,
    ).toHaveLength(1);
    // La relance : les agents qui n'ont pas validé, et pas l'encadrement resté
    // inscrit — le gestionnaire d'avant la décision, ni l'agent promu depuis.
    await be(chef);
    await live.query("select public.remind_campaign($1)", [open]);
    await be(null);
    const reminded = (
      await live.query<{ user_id: string }>(
        "select user_id from public.notifications where kind='CAMPAIGN_REMINDER' and organization_id=$1 order by user_id",
        [org],
      )
    ).rows.map(row => row.user_id);
    expect(reminded).toEqual([agent, demoted, newAgent].sort());
  });

  it("au déverrouillage, n’inscrit que les agents", async () => {
    await be(admin);
    await live.query("update public.availability_campaigns set locked=false where id=$1", [locked]);
    expect(await participants(locked)).toEqual([agent, demoted, newAgent].sort());
  });

  it("n’ouvre pas la règle aux visiteurs sans compte", async () => {
    await live.exec("reset role");
    await live.exec("set role anon");
    await expect(live.query("select private.takes_shifts('AGENT')")).rejects.toThrow();
    await live.exec("reset role");
  });
});

describe("Migration 20261016150000 — rattrapage et gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261016150000_encadrement_hors_campagnes.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("retire l’encadrement des campagnes en cours s’il n’y a rien saisi, sans toucher aux saisies ni à l’historique", async () => {
    const org = "10000000-0000-0000-0000-0000000000c7";
    const team = "20000000-0000-0000-0000-0000000000c7";
    const chef = "30000000-0000-0000-0000-0000000000d1";
    const busyChef = "30000000-0000-0000-0000-0000000000d2";
    const agent = "30000000-0000-0000-0000-0000000000d3";
    const open = "40000000-0000-0000-0000-0000000000d1";
    const closed = "40000000-0000-0000-0000-0000000000d2";
    const before = await upTo(target);
    await before.exec(`
      insert into auth.users(id) values ('${chef}'), ('${busyChef}'), ('${agent}');
      insert into public.profiles(user_id,display_name) values ('${chef}','Chef'), ('${busyChef}','Chef qui a saisi'), ('${agent}','Agent');
      insert into public.organizations(id,name) values ('${org}','Centre C7');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values
        ('${org}','${chef}','${team}','GESTIONNAIRE',true),
        ('${org}','${busyChef}','${team}','ADMIN',true),
        ('${org}','${agent}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values
        ('${open}','${org}','${team}','Octobre C7','2026-10-01','2026-10-01',now()-interval '1 day',now()+interval '9 days'),
        ('${closed}','${org}','${team}','Septembre C7','2026-09-01','2026-09-01',now()-interval '30 days',now()-interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${open}','${chef}'), ('${org}','${open}','${busyChef}'), ('${org}','${open}','${agent}'),
        ('${org}','${closed}','${chef}'), ('${org}','${closed}','${agent}');
      insert into public.availability_entries(campaign_id,user_id,date,availability_type) values
        ('${open}','${busyChef}','2026-10-01','NIGHT');`);
    await before.exec(migration());
    const rows = await before.query<{ campaign_id: string; user_id: string }>(
      "select campaign_id, user_id from public.campaign_participants where organization_id=$1 order by campaign_id, user_id",
      [org],
    );
    expect(rows.rows).toEqual([
      { campaign_id: open, user_id: busyChef },
      { campaign_id: open, user_id: agent },
      { campaign_id: closed, user_id: chef },
      { campaign_id: closed, user_id: agent },
    ]);
    expect(
      (await before.query("select 1 from public.availability_entries where user_id=$1", [busyChef])).rows,
    ).toHaveLength(1);
    await before.close();
  }, 90000);

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261007150000_droits_par_ensemble.sql");
    await early.close();
  }, 90000);
});

// C4 de la revue d'ergonomie (16 octobre) : la saisie rapide applique une
// semaine type — une valeur par jour de semaine, ou rien — sur une période, en
// une seule écriture, et peut ne remplir que les jours non renseignés.
describe("Semaine type — apply_week", () => {
  const org = "10000000-0000-0000-0000-0000000000a4";
  const team = "20000000-0000-0000-0000-0000000000a4";
  const agent = "30000000-0000-0000-0000-0000000000a4";
  const outsider = "30000000-0000-0000-0000-0000000000a5";
  const october = "40000000-0000-0000-0000-0000000000a4";
  const closed = "40000000-0000-0000-0000-0000000000a5";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const applyWeek = async (
    week: Record<string, string | null>,
    { from = "2026-10-01", to = "2026-10-31", keep = false, note = "", campaign = october } = {},
  ) =>
    (
      await live.query<{ n: number }>("select public.apply_week($1, $2::jsonb, $3, $4, $5, $6) as n", [
        campaign,
        JSON.stringify(week),
        from,
        to,
        keep,
        note,
      ])
    ).rows[0].n;
  const entries = async () => {
    await live.exec("reset role");
    return Object.fromEntries(
      (
        await live.query<{ date: string; availability_type: string; comment: string }>(
          "select date::text as date, availability_type, comment from public.availability_entries where campaign_id=$1 and user_id=$2 order by date",
          [october, agent],
        )
      ).rows.map(row => [row.date, `${row.availability_type}${row.comment ? ` (${row.comment})` : ""}`]),
    );
  };
  const validated = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ validated_at: unknown }>(
        "select validated_at from public.campaign_participants where campaign_id=$1 and user_id=$2",
        [october, agent],
      )
    ).rows[0].validated_at;
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`insert into auth.users(id) values ('${agent}'), ('${outsider}');
      insert into public.profiles(user_id,display_name) values ('${agent}','Agent'), ('${outsider}','Hors campagne');
      insert into public.organizations(id,name) values ('${org}','Centre semaine');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${agent}','${team}','AGENT',true), ('${org}','${outsider}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values
        ('${october}','${org}','${team}','Octobre','2026-10-01','2026-10-31',now()-interval '1 day',now()+interval '10 days'),
        ('${closed}','${org}','${team}','Septembre','2026-09-01','2026-09-30',now()-interval '40 days',now()-interval '10 days');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${october}','${agent}'), ('${org}','${closed}','${agent}');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("écrit chaque jour de semaine choisi sur la période, et seulement eux", async () => {
    await be(agent);
    // Lundis indisponibles, samedis 24 h, du 5 au 19 : le 26 n'est pas touché.
    expect(
      await applyWeek({ 1: "UNAVAILABLE", 6: "FULL_24H", 2: null }, { from: "2026-10-05", to: "2026-10-19" }),
    ).toBe(5);
    expect(await entries()).toEqual({
      "2026-10-05": "UNAVAILABLE",
      "2026-10-10": "FULL_24H",
      "2026-10-12": "UNAVAILABLE",
      "2026-10-17": "FULL_24H",
      "2026-10-19": "UNAVAILABLE",
    });
  });

  it("ne remplit que les jours non renseignés quand on le demande, et sinon remplace", async () => {
    await be(agent);
    // Tous les lundis de jour, sans toucher aux lundis déjà renseignés.
    expect(await applyWeek({ 1: "DAY" }, { keep: true, note: "après 9 h" })).toBe(1);
    expect((await entries())["2026-10-05"]).toBe("UNAVAILABLE");
    expect((await entries())["2026-10-26"]).toBe("DAY (après 9 h)");
    // Sans la précaution, la semaine l'emporte.
    await be(agent);
    expect(await applyWeek({ 1: "NIGHT" })).toBe(4);
    expect((await entries())["2026-10-05"]).toBe("NIGHT");
  });

  it("ramène la période à la campagne", async () => {
    await be(agent);
    // Dimanches : du 1er septembre au 30 novembre, seuls ceux d'octobre existent.
    expect(await applyWeek({ 7: "DAY" }, { from: "2026-09-01", to: "2026-11-30" })).toBe(4);
  });

  it("remet une réponse validée à valider, comme toute saisie", async () => {
    await be(agent);
    await applyWeek({ 1: "DAY", 2: "DAY", 3: "DAY", 4: "DAY", 5: "DAY", 6: "DAY", 7: "DAY" });
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1", [october]);
    expect(await validated()).not.toBeNull();
    await be(agent);
    await applyWeek({ 3: "NIGHT" }, { from: "2026-10-07", to: "2026-10-07" });
    expect(await validated()).toBeNull();
  });

  it("refuse une semaine mal formée, une période à l’envers, une campagne close ou sans participation", async () => {
    await be(agent);
    await expect(applyWeek({ 8: "DAY" })).rejects.toThrow("Invalid availability week");
    await expect(applyWeek({ 1: "MATIN" })).rejects.toThrow("Invalid availability week");
    await expect(applyWeek({ 1: "DAY" }, { from: "2026-10-20", to: "2026-10-10" })).rejects.toThrow(
      "Invalid availability period",
    );
    await expect(applyWeek({ 1: "DAY" }, { note: "x".repeat(501) })).rejects.toThrow(
      "Availability comment is too long",
    );
    await expect(applyWeek({ 1: "DAY" }, { campaign: closed, from: "2026-09-01", to: "2026-09-30" })).rejects.toThrow(
      "Campaign is closed",
    );
    await be(outsider);
    await expect(applyWeek({ 1: "DAY" })).rejects.toThrow("Not a participant of this campaign");
  });

  it("n’ouvre la fonction qu’aux comptes connectés", async () => {
    await live.exec("reset role");
    await live.exec("set role anon");
    await expect(applyWeek({ 1: "DAY" })).rejects.toThrow();
    await live.exec("reset role");
  });
});

describe("Migration 20261016200000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261016200000_semaine_type.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261016150000_encadrement_hors_campagnes.sql");
    await early.close();
  }, 90000);
});

// Lot A des évolutions opérationnelles (20 octobre) : ce que le traitement
// planifié crée — rappels de garde la veille, relances avant clôture —, ce
// qu'il annule, et ce qu'il retient. Les instants sont donnés explicitement :
// le calcul de « la veille à 18 h » se vérifie de part et d'autre de l'heure.
describe("Traitements planifiés — rappels de garde", () => {
  const org = "10000000-0000-0000-0000-0000000000b1";
  const off = "10000000-0000-0000-0000-0000000000b2";
  const team = "20000000-0000-0000-0000-0000000000b1";
  const offTeam = "20000000-0000-0000-0000-0000000000b2";
  const agent = "30000000-0000-0000-0000-0000000000b1";
  const night = "30000000-0000-0000-0000-0000000000b2";
  const chef = "30000000-0000-0000-0000-0000000000b3";
  const gone = "30000000-0000-0000-0000-0000000000b4";
  const relieved = "30000000-0000-0000-0000-0000000000b5";
  const removed = "30000000-0000-0000-0000-0000000000b6";
  const elsewhere = "30000000-0000-0000-0000-0000000000b7";
  const leaving = "30000000-0000-0000-0000-0000000000b8";
  const campaign = "40000000-0000-0000-0000-0000000000b1";
  const offCampaign = "40000000-0000-0000-0000-0000000000b2";
  const schedule = "50000000-0000-0000-0000-0000000000b1";
  const offSchedule = "50000000-0000-0000-0000-0000000000b2";
  let live: PGlite;
  let shiftCount = 0;
  const generate = async (at: string) => {
    await live.exec("reset role");
    return (await live.query<{ r: Record<string, number> }>("select private.generate_due_notifications($1) as r", [at]))
      .rows[0].r;
  };
  const reminders = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ user_id: string; body: string; email_status: string }>(
        "select user_id, body, email_status from public.notifications where kind='SHIFT_REMINDER' order by user_id, event_key",
      )
    ).rows;
  };
  // Une garde publiée, avec ses affectés à la version publiée, insérée sans les
  // contrôles de saisie : on vérifie ici ce que le traitement en lit.
  const publish = async (
    date: string,
    shift: "DAY" | "NIGHT",
    users: string[],
    { publishedAt = "2026-10-20 08:00:00+00", sched = schedule, orgId = org } = {},
  ) => {
    shiftCount++;
    const id = `60000000-0000-0000-0000-${String(shiftCount).padStart(12, "0")}`;
    await live.exec("reset role");
    await live.exec("set session_replication_role = replica");
    await live.query(
      "insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code,published_revision,published_at) values ($1,$2,$3,$4,$5,1,$6)",
      [id, orgId, sched, date, shift, publishedAt],
    );
    for (const user of users)
      await live.query(
        "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by) values ($1,$2,$3,1,'CONFIRMED',$3)",
        [orgId, id, user],
      );
    await live.exec("set session_replication_role = origin");
    return id;
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${agent}'), ('${night}'), ('${chef}'), ('${gone}'), ('${relieved}'),
        ('${removed}'), ('${elsewhere}'), ('${leaving}');
      insert into public.profiles(user_id,display_name) values ('${agent}','Agent'), ('${night}','Nuit'), ('${chef}','Chef'),
        ('${gone}','Parti'), ('${relieved}','Relevé'), ('${removed}','Retiré'), ('${elsewhere}','Ailleurs'), ('${leaving}','Sur le départ');
      insert into public.organizations(id,name,reminders_enabled) values ('${org}','Centre rappels',true), ('${off}','Centre sans rappels',false);
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha'), ('${offTeam}','${off}','Alpha');
      insert into public.memberships values
        ('${org}','${agent}','${team}','AGENT',true), ('${org}','${night}','${team}','AGENT',true),
        ('${org}','${chef}','${team}','GESTIONNAIRE',true), ('${org}','${gone}','${team}','AGENT',false),
        ('${org}','${relieved}','${team}','AGENT',true), ('${org}','${removed}','${team}','AGENT',true),
        ('${org}','${leaving}','${team}','AGENT',true), ('${off}','${elsewhere}','${offTeam}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at) values
        ('${campaign}','${org}','${team}','Novembre','2026-11-01','2026-11-30',now()-interval '30 days',now()-interval '1 day'),
        ('${offCampaign}','${off}','${offTeam}','Novembre','2026-11-01','2026-11-30',now()-interval '30 days',now()-interval '1 day');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values
        ('${schedule}','${org}','${campaign}','${team}'), ('${offSchedule}','${off}','${offCampaign}','${offTeam}');`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("rappelle la veille à 18 h, heure du centre, une seule fois, et réunit le Jour et la Nuit en 24 h", async () => {
    // Le 3 novembre : l'agent tient le Jour et la Nuit. La version publiée du
    // Jour (2) a retiré un agent ; un autre s'est désisté après publication.
    const day = await publish("2026-11-03", "DAY", [agent, chef, gone, relieved]);
    await publish("2026-11-03", "NIGHT", [agent]);
    await live.exec("set session_replication_role = replica");
    await live.query(
      "update public.schedule_shifts set published_revision=2, published_at='2026-10-21 08:00:00+00' where id=$1",
      [day],
    );
    await live.query("update public.schedule_assignments set revision=2 where schedule_shift_id=$1", [day]);
    await live.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by) values ($1,$2,$3,1,'CONFIRMED',$3)",
      [org, day, removed],
    );
    await live.query(
      `insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,state,decided_at,decided_by)
       values ($1,$2,$3,'ACCEPTED','2026-10-25 08:00:00+00',$4)`,
      [org, day, relieved, chef],
    );
    await live.exec("set session_replication_role = origin");
    await publish("2026-11-03", "DAY", [elsewhere], { sched: offSchedule, orgId: off });

    // 18 h à Paris le 2 novembre : 17 h UTC.
    expect((await generate("2026-11-02 16:59:00+00")).rappels_de_garde).toBe(0);
    expect((await generate("2026-11-02 17:01:00+00")).rappels_de_garde).toBe(1);
    expect(await reminders()).toEqual([
      {
        user_id: agent,
        body: "Vous êtes de garde demain, mardi 3 novembre, de 8 h à 8 h le lendemain (24 h).",
        email_status: "pending",
      },
    ]);
    // Le passage suivant ne recrée rien.
    expect((await generate("2026-11-02 17:06:00+00")).rappels_de_garde).toBe(0);
  });

  it("dit la nuit, et n’envoie rien pour une garde publiée après l’heure du rappel", async () => {
    await publish("2026-11-04", "NIGHT", [night]);
    await publish("2026-11-05", "DAY", [night], { publishedAt: "2026-11-04 17:30:00+00" });
    expect((await generate("2026-11-03 17:05:00+00")).rappels_de_garde).toBe(1);
    expect((await reminders()).find(r => r.user_id === night)?.body).toBe(
      "Vous êtes de garde demain, mercredi 4 novembre, de 20 h à 8 h le lendemain.",
    );
    // L'avis de publication vient de partir : pas de rappel en plus.
    expect((await generate("2026-11-04 17:35:00+00")).rappels_de_garde).toBe(0);
  });

  it("ne rattrape pas un rappel manqué : passé minuit, « demain » serait faux", async () => {
    await publish("2026-11-06", "DAY", [night]);
    // 0 h 30 à Paris le 6 novembre.
    expect((await generate("2026-11-05 23:30:00+00")).rappels_de_garde).toBe(0);
  });

  it("suit l’heure locale quand l’heure change dans la nuit", async () => {
    // Retour à l'heure d'hiver le dimanche 25 octobre 2026 : 18 h y vaut 17 h UTC.
    await publish("2026-10-26", "DAY", [night]);
    expect((await generate("2026-10-25 16:59:00+00")).rappels_de_garde).toBe(0);
    expect((await generate("2026-10-25 17:01:00+00")).rappels_de_garde).toBe(1);
    // Passage à l'heure d'été le dimanche 28 mars 2027 : 18 h y vaut 16 h UTC.
    await publish("2027-03-29", "DAY", [night]);
    expect((await generate("2027-03-28 15:59:00+00")).rappels_de_garde).toBe(0);
    expect((await generate("2027-03-28 16:01:00+00")).rappels_de_garde).toBe(1);
  });

  it("annule un rappel encore en attente quand l’agent ne tient plus la garde", async () => {
    await live.exec("reset role");
    await live.query(
      "insert into public.push_subscriptions(organization_id,user_id,endpoint,p256dh,auth) values ($1,$2,$3,$4,$5)",
      [org, leaving, "https://fcm.googleapis.com/fcm/send/essai-depart", "A".repeat(87), "B".repeat(22)],
    );
    await publish("2026-11-10", "DAY", [leaving]);
    expect((await generate("2026-11-09 17:05:00+00")).rappels_de_garde).toBe(1);
    const pending = await live.query<{ status: string }>(
      "select d.status from public.push_deliveries d join public.notifications n on n.id=d.notification_id where n.user_id=$1 and n.kind='SHIFT_REMINDER'",
      [leaving],
    );
    expect(pending.rows).toEqual([{ status: "pending" }]);
    // Désactivé avant l'envoi : ni email, ni push.
    await live.exec("set session_replication_role = replica");
    await live.query("update public.memberships set active=false where user_id=$1", [leaving]);
    await live.exec("set session_replication_role = origin");
    expect((await generate("2026-11-09 17:10:00+00")).annulations).toBe(1);
    expect((await reminders()).find(r => r.user_id === leaving)?.email_status).toBe("skipped");
    const after = await live.query<{ status: string }>(
      "select d.status from public.push_deliveries d join public.notifications n on n.id=d.notification_id where n.user_id=$1 and n.kind='SHIFT_REMINDER'",
      [leaving],
    );
    expect(after.rows).toEqual([{ status: "suppressed" }]);
  });

  it("inscrit chaque passage au journal", async () => {
    await live.exec("reset role");
    const runs = await live.query<{ ok: boolean; summary: Record<string, number> }>(
      "select ok, summary from private.scheduled_runs where task='generation' order by id desc limit 1",
    );
    expect(runs.rows[0].ok).toBe(true);
    expect(Object.keys(runs.rows[0].summary).sort()).toEqual([
      "annulations",
      "appels_expires",
      "photographies",
      "rappels_de_garde",
      "relances",
    ]);
  });

  // Les files se vident aussi après chaque commande : le désistement accepté
  // déclenche un vidage juste après. L'agent reste actif, la réservation ne
  // l'écartait donc pas d'elle-même. Elle recontrôle à l'instant présent : la
  // garde est datée d'après l'horloge, pas d'une date fixe.
  it("ne laisse partir par aucune réservation le rappel d’une garde qui n’est plus tenue", async () => {
    const kept = "30000000-0000-0000-0000-0000000000b9";
    const withdrawn = "30000000-0000-0000-0000-0000000000ba";
    await live.exec("reset role");
    await live.query(
      "insert into auth.users(id,email) values ($1,'garde@rappels.test'), ($2,'desistement@rappels.test')",
      [kept, withdrawn],
    );
    await live.query("insert into public.profiles(user_id,display_name) values ($1,'Garde'), ($2,'Désistement')", [
      kept,
      withdrawn,
    ]);
    await live.query("insert into public.memberships values ($1,$2,$3,'AGENT',true), ($1,$4,$3,'AGENT',true)", [
      org,
      kept,
      team,
      withdrawn,
    ]);
    for (const [user, name] of [
      [kept, "garde"],
      [withdrawn, "desistement"],
    ])
      await live.query(
        "insert into public.push_subscriptions(organization_id,user_id,endpoint,p256dh,auth) values ($1,$2,$3,$4,$5)",
        [org, user, `https://fcm.googleapis.com/fcm/send/essai-${name}`, "A".repeat(87), "B".repeat(22)],
      );
    const { day, eve } = (
      await live.query<{ day: string; eve: string }>(
        `select to_char(d, 'YYYY-MM-DD') as day, (((d - 1) + time '18:05') at time zone 'Europe/Paris')::text as eve
           from (select (now() at time zone 'Europe/Paris')::date + 2 as d) t`,
      )
    ).rows[0];
    const shift = await publish(day, "DAY", [kept, withdrawn]);
    await generate(eve);
    const reminder = async (user: string) =>
      (
        await live.query<{ id: string; email_status: string }>(
          "select id, email_status from public.notifications where kind='SHIFT_REMINDER' and user_id=$1",
          [user],
        )
      ).rows[0];
    expect((await reminder(kept)).email_status).toBe("pending");
    expect((await reminder(withdrawn)).email_status).toBe("pending");

    await live.exec("set session_replication_role = replica");
    await live.query(
      `insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,state,decided_at,decided_by)
       values ($1,$2,$3,'ACCEPTED',now(),$4)`,
      [org, shift, withdrawn, chef],
    );
    await live.exec("set session_replication_role = origin");

    await live.exec("set role service_role");
    const emails = (await live.query<{ id: string }>("select id from public.claim_email_deliveries(200)")).rows.map(
      r => r.id,
    );
    const pushes = (
      await live.query<{ notification_id: string }>("select notification_id from public.claim_push_deliveries()")
    ).rows.map(r => r.notification_id);
    await live.exec("reset role");
    const keptReminder = await reminder(kept);
    const withdrawnReminder = await reminder(withdrawn);
    expect(emails).toContain(keptReminder.id);
    expect(pushes).toContain(keptReminder.id);
    expect(emails).not.toContain(withdrawnReminder.id);
    expect(pushes).not.toContain(withdrawnReminder.id);
    expect(withdrawnReminder.email_status).toBe("skipped");
    const push = await live.query<{ status: string }>(
      "select status from public.push_deliveries where notification_id=$1",
      [withdrawnReminder.id],
    );
    expect(push.rows).toEqual([{ status: "suppressed" }]);
  });
});

describe("Traitements planifiés — relances avant clôture", () => {
  const org = "10000000-0000-0000-0000-0000000000b3";
  const team = "20000000-0000-0000-0000-0000000000b3";
  const late = "30000000-0000-0000-0000-0000000000c8";
  const done = "30000000-0000-0000-0000-0000000000c9";
  const chef = "30000000-0000-0000-0000-0000000000ca";
  let live: PGlite;
  let campaignCount = 0;
  // Une campagne qui clôt à `closes`, ouverte depuis `opened`.
  const campaign = async (closes: string, opened: string, { locked = false } = {}) => {
    campaignCount++;
    const id = `40000000-0000-0000-0000-${String(campaignCount).padStart(12, "0")}`;
    const month = `2027-${String(campaignCount).padStart(2, "0")}-01`;
    await live.exec("reset role");
    await live.exec("set session_replication_role = replica");
    await live.query(
      "insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at,locked) values ($1,$2,$3,$4,$5,$5,$6,$7,$8)",
      [id, org, team, `Campagne ${campaignCount}`, month, opened, closes, locked],
    );
    await live.query(
      `insert into public.campaign_participants(organization_id,campaign_id,user_id,validated_at) values
         ($1,$2,$3,null), ($1,$2,$4,now()), ($1,$2,$5,null)`,
      [org, id, late, done, chef],
    );
    await live.exec("set session_replication_role = origin");
    return id;
  };
  const generate = async (at: string) => {
    await live.exec("reset role");
    return (await live.query<{ r: Record<string, number> }>("select private.generate_due_notifications($1) as r", [at]))
      .rows[0].r;
  };
  const stages = async (id: string) => {
    await live.exec("reset role");
    return (
      await live.query<{ stage: string; outcome: string; recipients: number }>(
        "select stage, outcome, recipients from private.campaign_auto_reminders where campaign_id=$1 order by stage desc",
        [id],
      )
    ).rows;
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${late}'), ('${done}'), ('${chef}');
      insert into public.profiles(user_id,display_name) values ('${late}','En retard'), ('${done}','A validé'), ('${chef}','Chef');
      insert into public.organizations(id,name,reminders_enabled) values ('${org}','Centre relances',true);
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${late}','${team}','AGENT',true),
        ('${org}','${done}','${team}','AGENT',true), ('${org}','${chef}','${team}','GESTIONNAIRE',true);`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("relance 48 h puis 24 h avant la clôture, l’agent qui n’a pas validé, et lui seul", async () => {
    const id = await campaign("2026-12-20 22:59:59+00", "2026-12-01 00:00:00+00");
    expect((await generate("2026-12-18 23:30:00+00")).relances).toBe(1);
    expect(await stages(id)).toEqual([{ stage: "48h", outcome: "sent", recipients: 1 }]);
    const sent = await live.query<{ user_id: string; body: string }>(
      "select user_id, body from public.notifications where kind='CAMPAIGN_REMINDER' and event_key like $1",
      [`campaign-reminder:${id}:%`],
    );
    expect(sent.rows).toEqual([
      { user_id: late, body: "Votre réponse n'est pas encore validée. La saisie ferme le 20/12/2026." },
    ]);
    expect((await generate("2026-12-19 01:00:00+00")).relances).toBe(0);
    // 24 h avant : la relance de 48 h date de plus de 12 h, celle-ci part.
    expect((await generate("2026-12-20 00:00:00+00")).relances).toBe(1);
    expect(await stages(id)).toEqual([
      { stage: "48h", outcome: "sent", recipients: 1 },
      { stage: "24h", outcome: "sent", recipients: 1 },
    ]);
  });

  it("ne rattrape pas l’échéance de 48 h après une interruption", async () => {
    const id = await campaign("2026-12-21 22:59:59+00", "2026-12-01 00:00:00+00");
    expect((await generate("2026-12-21 03:00:00+00")).relances).toBe(1);
    expect(await stages(id)).toEqual([
      { stage: "48h", outcome: "superseded", recipients: 0 },
      { stage: "24h", outcome: "sent", recipients: 1 },
    ]);
  });

  it("partage la règle des 12 heures avec la relance manuelle, et compte l’ouverture", async () => {
    const recent = await campaign("2026-12-22 22:59:59+00", "2026-12-01 00:00:00+00");
    await live.query("insert into private.campaign_reminders(campaign_id,reminded_at,recipients) values ($1,$2,1)", [
      recent,
      "2026-12-21 20:00:00+00",
    ]);
    expect((await generate("2026-12-22 01:00:00+00")).relances).toBe(0);
    expect(await stages(recent)).toEqual([
      { stage: "48h", outcome: "superseded", recipients: 0 },
      { stage: "24h", outcome: "recent", recipients: 0 },
    ]);
    // Ouverte il y a deux heures : l'avis d'ouverture vient de partir.
    const fresh = await campaign("2026-12-25 12:00:00+00", "2026-12-23 22:00:00+00");
    expect((await generate("2026-12-24 00:00:00+00")).relances).toBe(0);
    expect(await stages(fresh)).toEqual([{ stage: "48h", outcome: "recent", recipients: 0 }]);
    // Verrouillée : rien.
    const locked = await campaign("2026-12-28 12:00:00+00", "2026-12-01 00:00:00+00", { locked: true });
    expect((await generate("2026-12-27 00:00:00+00")).relances).toBe(0);
    expect(await stages(locked)).toEqual([]);
  });

  it("annule la relance encore en attente d’un agent qui vient de valider", async () => {
    const id = await campaign("2026-12-30 22:59:59+00", "2026-12-01 00:00:00+00");
    expect((await generate("2026-12-29 00:00:00+00")).relances).toBe(1);
    await live.exec("set session_replication_role = replica");
    await live.query("update public.campaign_participants set validated_at=now() where campaign_id=$1 and user_id=$2", [
      id,
      late,
    ]);
    await live.exec("set session_replication_role = origin");
    expect((await generate("2026-12-29 00:05:00+00")).annulations).toBe(1);
    const status = await live.query<{ email_status: string }>(
      "select email_status from public.notifications where event_key like $1",
      [`campaign-reminder:${id}:%`],
    );
    expect(status.rows).toEqual([{ email_status: "skipped" }]);
  });
});

describe("Traitements planifiés — réglage, suivi et droits", () => {
  const org = "10000000-0000-0000-0000-0000000000b4";
  const team = "20000000-0000-0000-0000-0000000000b4";
  const agent = "30000000-0000-0000-0000-0000000000d1";
  const chef = "30000000-0000-0000-0000-0000000000d2";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${agent}'), ('${chef}');
      insert into public.profiles(user_id,display_name) values ('${agent}','Agent'), ('${chef}','Chef');
      insert into public.organizations(id,name) values ('${org}','Centre réglages');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${agent}','${team}','AGENT',true), ('${org}','${chef}','${team}','GESTIONNAIRE',true);`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("laisse l’encadrement activer les rappels et choisir l’heure, pas l’agent", async () => {
    const read = async () =>
      (
        await live.query<{ reminders_enabled: boolean; shift_reminder_hour: number }>(
          "select reminders_enabled, shift_reminder_hour from public.organizations where id=$1",
          [org],
        )
      ).rows[0];
    await be(agent);
    await live.query("update public.organizations set reminders_enabled=true where id=$1", [org]);
    await live.exec("reset role");
    expect(await read()).toEqual({ reminders_enabled: false, shift_reminder_hour: 18 });
    await be(chef);
    await live.query("update public.organizations set reminders_enabled=true, shift_reminder_hour=19 where id=$1", [
      org,
    ]);
    await live.exec("reset role");
    expect(await read()).toEqual({ reminders_enabled: true, shift_reminder_hour: 19 });
    // L'activation est un acte : elle entre au journal, avec son auteur.
    expect(
      (
        await live.query<{ actor_id: string; action: string; new_value: unknown }>(
          "select actor_id, action, new_value from public.audit_logs where organization_id=$1 and action='REMINDERS'",
          [org],
        )
      ).rows,
    ).toEqual([
      { actor_id: chef, action: "REMINDERS", new_value: { reminders_enabled: true, shift_reminder_hour: 19 } },
    ]);
    await be(chef);
    await expect(
      live.query("update public.organizations set shift_reminder_hour=24 where id=$1", [org]),
    ).rejects.toThrow();
  });

  it("montre l’état des traitements à l’encadrement seulement, sans détail personnel", async () => {
    await live.exec("reset role");
    await live.query("select private.generate_due_notifications(now())");
    await be(chef);
    const status = (await live.query<{ s: Record<string, unknown> }>("select public.scheduled_status($1) as s", [org]))
      .rows[0].s;
    expect(Object.keys(status).sort()).toEqual([
      "derniere_erreur",
      "emails_en_attente",
      "emails_en_echec_24h",
      "erreurs_24h",
      "generation",
      "livraison",
      "livraison_silencieuse",
      "push_en_attente",
      "silencieux",
    ]);
    expect(status.silencieux).toBe(false);
    expect(status.livraison_silencieuse).toBe(false);
    expect(status.generation).not.toBeNull();
    await be(agent);
    await expect(live.query("select public.scheduled_status($1)", [org])).rejects.toThrow(
      "Not allowed to read the scheduled tasks",
    );
  });

  it("réserve la livraison et son journal à la clé du serveur", async () => {
    await be(chef);
    await expect(live.query("select public.cancel_obsolete_notifications()")).rejects.toThrow();
    await expect(
      live.query("select public.record_scheduled_run('livraison', true, '{}'::jsonb, null)"),
    ).rejects.toThrow();
    await live.exec("reset role");
    await live.exec("set role service_role");
    await live.query("select public.cancel_obsolete_notifications()");
    await live.query("select public.record_scheduled_run('livraison', true, '{\"emails\":0}'::jsonb, null)");
    await live.exec("reset role");
    const last = await live.query<{ task: string; ok: boolean }>(
      "select task, ok from private.scheduled_runs order by id desc limit 1",
    );
    expect(last.rows).toEqual([{ task: "livraison", ok: true }]);
  });

  // Le secret mal recopié dans Vault : la génération tourne, la livraison
  // n'arrive jamais à l'application et n'inscrit rien.
  it("signale une livraison qui ne suit plus la génération, pas celle qui n’a pas encore eu le temps", async () => {
    const silent = async () => {
      await be(chef);
      const status = (
        await live.query<{ s: Record<string, unknown> }>("select public.scheduled_status($1) as s", [org])
      ).rows[0].s;
      await live.exec("reset role");
      return status.livraison_silencieuse;
    };
    const run = (task: string, minutesAgo: number) =>
      live.query(
        `insert into private.scheduled_runs(task, started_at, finished_at, ok)
         values ($1, now() - make_interval(mins => $2), now() - make_interval(mins => $2), true)`,
        [task, minutesAgo],
      );
    await live.exec("reset role");
    await live.exec("delete from private.scheduled_runs");
    // Juste après l'activation : une génération, pas encore de livraison.
    await run("generation", 1);
    expect(await silent()).toBe(false);
    // Trois générations depuis la dernière livraison, la première il y a vingt minutes.
    await run("livraison", 25);
    await run("generation", 20);
    await run("generation", 10);
    expect(await silent()).toBe(true);
    // Une livraison en échec arrive quand même : elle se compte comme erreur, pas comme silence.
    await live.query("insert into private.scheduled_runs(task, finished_at, ok) values ('livraison', now(), false)");
    expect(await silent()).toBe(false);
  });
});

describe("Migration 20261020090000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261020090000_traitements_planifies.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261016200000_semaine_type.sql");
    await early.close();
  }, 90000);
});

// Lot A, seconde partie (20 octobre) : le contrat de photographies de la
// spécification. Chaque cas vérifie qu'un fait retient l'état de son instant —
// publication, clôture, début de créneau — et que rien de ce qui suit ne le
// réécrit : ni une qualification acquise, ni un départ, ni une promotion.
describe("Photographies — publication, clôture et début de créneau", () => {
  const org = "10000000-0000-0000-0000-0000000000e1";
  const team = "20000000-0000-0000-0000-0000000000e1";
  const bravo = "20000000-0000-0000-0000-0000000000e2";
  const chef = "30000000-0000-0000-0000-0000000000e1";
  const alice = "30000000-0000-0000-0000-0000000000e2";
  const bob = "30000000-0000-0000-0000-0000000000e3";
  const carl = "30000000-0000-0000-0000-0000000000e4";
  const late = "30000000-0000-0000-0000-0000000000e5";
  const campaign = "40000000-0000-0000-0000-0000000000e1";
  const bravoCampaign = "40000000-0000-0000-0000-0000000000e2";
  const schedule = "50000000-0000-0000-0000-0000000000e1";
  const bravoSchedule = "50000000-0000-0000-0000-0000000000e2";
  const day1 = "60000000-0000-0000-0000-0000000000e1";
  const night1 = "60000000-0000-0000-0000-0000000000e2";
  const day2 = "60000000-0000-0000-0000-0000000000e3";
  const yesterday = "60000000-0000-0000-0000-0000000000e4";
  const inc = "70000000-0000-0000-0000-0000000000e1";
  const cod = "70000000-0000-0000-0000-0000000000e2";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const rows = async <T>(sql: string, params: unknown[] = []) => {
    await live.exec("reset role");
    return (await live.query<T>(sql, params)).rows;
  };
  const generate = async (at: string) =>
    (
      await rows<{ r: { photographies: { clotures: number; debuts: number } } }>(
        "select private.generate_due_notifications($1) as r",
        [at],
      )
    )[0].r;

  beforeAll(async () => {
    live = await freshDatabase();
    // Deux colonnes que Supabase fournit et que l'export lit.
    await live.exec(
      "alter table auth.users add column created_at timestamptz default now(), add column last_sign_in_at timestamptz",
    );
    await live.exec(`
      insert into auth.users(id,email) values ('${chef}','chef@photos.test'), ('${alice}','alice@photos.test'),
        ('${bob}','bob@photos.test'), ('${carl}','carl@photos.test'), ('${late}','late@photos.test');
      insert into public.profiles(user_id,display_name) values ('${chef}','Chef'), ('${alice}','Alice'), ('${bob}','Bob'),
        ('${carl}','Carl'), ('${late}','Tardif');
      insert into public.organizations(id,name) values ('${org}','Centre photos');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha'), ('${bravo}','${org}','Bravo');
      insert into public.memberships values ('${org}','${chef}','${team}','GESTIONNAIRE',true),
        ('${org}','${alice}','${team}','AGENT',true), ('${org}','${bob}','${team}','AGENT',true),
        ('${org}','${carl}','${team}','AGENT',true);
      insert into public.qualifications(id,organization_id,name) values ('${inc}','${org}','INC1'), ('${cod}','${org}','COD2');
      insert into public.user_qualifications(organization_id,user_id,qualification_id) values
        ('${org}','${alice}','${inc}'), ('${org}','${bob}','${inc}'), ('${org}','${bob}','${cod}');
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2026-11-01','2026-11-30',now()-interval '10 days',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${campaign}','${alice}'), ('${org}','${campaign}','${bob}'), ('${org}','${campaign}','${carl}');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code) values
        ('${day1}','${org}','${schedule}','2026-11-01','DAY'), ('${night1}','${org}','${schedule}','2026-11-01','NIGHT'),
        ('${day2}','${org}','${schedule}','2026-11-02','DAY');
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount) values
        ('${org}','${campaign}','2026-11-01','DAY',2), ('${org}','${campaign}','2026-11-01','NIGHT',1);
      insert into public.staffing_requirement_qualifications(organization_id,requirement_id,qualification_id,minimum)
        select '${org}', r.id, q.id, 1 from public.staffing_requirements r, public.qualifications q
         where r.campaign_id='${campaign}' and r.shift_code='DAY';
      set session_replication_role = replica;
      insert into public.availability_entries(campaign_id,user_id,date,availability_type) values
        ('${campaign}','${alice}','2026-11-01','FULL_24H'), ('${campaign}','${bob}','2026-11-01','FULL_24H');
      update public.campaign_participants set validated_at = now() - interval '1 hour' where user_id in ('${alice}','${bob}');
      set session_replication_role = origin;
      -- L'historique a commencé avant ces campagnes.
      update private.history_start set started_at = '2026-01-01';`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("fige à la publication le besoin, les minima et les qualifications de chaque affecté", async () => {
    await be(chef);
    for (const user of [alice, bob])
      await live.query(
        "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
        [org, day1, user, chef],
      );
    await live.query("select public.publish_shift($1)", [day1]);
    expect(
      await rows(
        `select team_name, revision, headcount_required, assigned_count, minima, holders, starts_at, ends_at
           from private.publication_facts where schedule_shift_id=$1`,
        [day1],
      ),
    ).toEqual([
      {
        team_name: "Alpha",
        revision: 1,
        headcount_required: 2,
        assigned_count: 2,
        minima: [
          { qualification_id: cod, qualification: "COD2", minimum: 1, holders: 1 },
          { qualification_id: inc, qualification: "INC1", minimum: 1, holders: 2 },
        ],
        holders: [
          { qualification_id: cod, qualification: "COD2", count: 1 },
          { qualification_id: inc, qualification: "INC1", count: 2 },
        ],
        // 8 h et 20 h à Paris, à l'heure d'hiver.
        starts_at: new Date("2026-11-01T07:00:00Z"),
        ends_at: new Date("2026-11-01T19:00:00Z"),
      },
    ]);
    expect(
      await rows("select user_id, role, qualifications from private.publication_assignees order by user_id"),
    ).toEqual([
      { user_id: alice, role: "AGENT", qualifications: ["INC1"] },
      { user_id: bob, role: "AGENT", qualifications: ["COD2", "INC1"] },
    ]);
  });

  it("ajoute une version à chaque republication, et ne réécrit ni l’une ni l’autre", async () => {
    await be(chef);
    await live.query("select public.publish_shift($1)", [day1]);
    // Bob perd sa COD2 après la publication : les photographies n'en savent rien.
    await live.query("delete from public.user_qualifications where user_id=$1 and qualification_id=$2", [bob, cod]);
    const facts = await rows<{ revision: number; holders: { qualification: string; count: number }[] }>(
      "select revision, holders from private.publication_facts where schedule_shift_id=$1 order by revision",
      [day1],
    );
    expect(facts.map(f => f.revision)).toEqual([1, 2]);
    for (const fact of facts) expect(fact.holders.find(h => h.qualification === "COD2")?.count).toBe(1);
    expect(
      await rows(
        "select count(*)::int as n from private.publication_assignees where user_id=$1 and 'COD2' = any(qualifications)",
        [bob],
      ),
    ).toEqual([{ n: 2 }]);
  });

  it("fige la clôture à sa date, avant la modification qui précède le passage planifié", async () => {
    await live.exec("reset role");
    await live.query("update public.availability_campaigns set closes_at = now() - interval '1 minute' where id=$1", [
      campaign,
    ]);
    // Carl est désactivé après la clôture, avant que le passage ne soit venu :
    // la photographie se prend d'abord, et le compte attendu.
    await live.query("update public.memberships set active=false where user_id=$1", [carl]);
    const closure = () =>
      rows("select source, participants, expected, validated from private.closure_facts where campaign_id=$1", [
        campaign,
      ]);
    expect(await closure()).toEqual([{ source: "modification", participants: 3, expected: 3, validated: 2 }]);
    expect(
      await rows(
        "select active, expected, validated_at is not null as validated from private.closure_participants where user_id=$1",
        [carl],
      ),
    ).toEqual([{ active: true, expected: true, validated: false }]);
    // Le passage, ensuite, ne la reprend pas ; une promotion et une arrivée
    // après la clôture n'y changent rien.
    expect((await generate(new Date().toISOString())).photographies.clotures).toBe(0);
    await live.exec(`
      set session_replication_role = replica;
      update public.memberships set role='GESTIONNAIRE' where user_id='${alice}';
      set session_replication_role = origin;
      insert into public.memberships values ('${org}','${late}','${team}','AGENT',true);`);
    expect((await generate(new Date().toISOString())).photographies.clotures).toBe(0);
    expect(await closure()).toEqual([{ source: "modification", participants: 3, expected: 3, validated: 2 }]);
    expect(await rows("select count(*)::int as n from private.closure_participants where user_id=$1", [late])).toEqual([
      { n: 0 },
    ]);
  });

  it("fige le début de chaque créneau : besoin, effectif tenu, qualifications de la publication", async () => {
    // Bob se désiste du Jour publié, et l'encadrement accepte ; Alice obtient la
    // COD2 après la publication — elle ne compterait pas pour ce créneau.
    await be(bob);
    await live.query(
      "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,'Empêché')",
      [org, day1, bob],
    );
    await be(chef);
    await live.query("update public.shift_withdrawals set state='ACCEPTED' where user_id=$1", [bob]);
    await live.exec("reset role");
    await live.query(
      "insert into public.user_qualifications(organization_id,user_id,qualification_id) values ($1,$2,$3)",
      [org, alice, cod],
    );
    // L'historique commence à midi le 1er : le Jour de 8 h lui est antérieur.
    await live.query("update private.history_start set started_at = '2026-11-01 12:00:00+01'");
    expect((await generate("2026-11-02 08:30:00+01")).photographies.debuts).toBe(2);
    await live.query("update private.history_start set started_at = '2026-01-01'");
    expect((await generate("2026-11-02 08:30:00+01")).photographies.debuts).toBe(1);
    const fact = async (shift: string) =>
      (
        await rows(
          `select revision, headcount_required, published_count, effective_count, withdrawn_count, minima,
                  minima_covered, covered from private.shift_start_facts where schedule_shift_id=$1`,
          [shift],
        )
      )[0];
    // Alice est passée gestionnaire au cas précédent : elle ne tient plus de
    // garde. Bob s'est désisté. Plus personne n'est tenu sur ce Jour.
    expect(await fact(day1)).toEqual({
      revision: 2,
      headcount_required: 2,
      published_count: 2,
      effective_count: 0,
      withdrawn_count: 1,
      minima: [
        { qualification_id: cod, qualification: "COD2", minimum: 1, holders: 0 },
        { qualification_id: inc, qualification: "INC1", minimum: 1, holders: 0 },
      ],
      minima_covered: false,
      covered: false,
    });
    // Jamais publiée : besoin défini, personne.
    expect(await fact(night1)).toMatchObject({
      revision: 0,
      headcount_required: 1,
      effective_count: 0,
      covered: false,
    });
    // Sans besoin : compté à part, jamais couvert.
    expect(await fact(day2)).toMatchObject({ revision: 0, headcount_required: null, covered: false });
  });

  it("compte les qualifications de la publication, pas celles d’aujourd’hui", async () => {
    // Le Jour du 2 novembre, publié avec Carl, revenu, sans COD2 ; il l'obtient
    // ensuite. Au début du créneau, la COD2 exigée n'est pas couverte.
    await live.exec(`
      set session_replication_role = replica;
      update public.memberships set active=true where user_id='${carl}';
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount)
        values ('${org}','${campaign}','2026-11-03','DAY',1);
      insert into public.staffing_requirement_qualifications(organization_id,requirement_id,qualification_id,minimum)
        select '${org}', id, '${cod}', 1 from public.staffing_requirements where date='2026-11-03';
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        values ('60000000-0000-0000-0000-0000000000e5','${org}','${schedule}','2026-11-03','DAY');
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
        values ('${org}','60000000-0000-0000-0000-0000000000e5','${carl}',1,'CONFIRMED','${chef}');
      set session_replication_role = origin;
      update public.schedule_shifts set published_revision=1, published_at=now()
       where id='60000000-0000-0000-0000-0000000000e5';
      insert into public.user_qualifications(organization_id,user_id,qualification_id) values ('${org}','${carl}','${cod}');`);
    await generate("2026-11-03 08:30:00+01");
    expect(
      await rows(
        "select effective_count, minima_covered, covered from private.shift_start_facts where schedule_shift_id=$1",
        ["60000000-0000-0000-0000-0000000000e5"],
      ),
    ).toEqual([{ effective_count: 1, minima_covered: false, covered: false }]);
  });

  it("retrouve l’état de l’heure de début quand le passage planifié est en retard", async () => {
    // Une garde d'hier, publiée, que le passage planifié n'a pas encore prise.
    await live.exec("reset role");
    await live.query(
      `insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
       select $1, $2, $3, 'Bravo', date_trunc('month', y)::date, (date_trunc('month', y) + interval '1 month - 1 day')::date,
              now() - interval '40 days', now() + interval '5 days'
         from (select (now() at time zone 'Europe/Paris')::date - 1 as y) t`,
      [bravoCampaign, org, bravo],
    );
    await live.exec(`
      set session_replication_role = replica;
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values ('${org}','${bravoCampaign}','${bob}');
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${bravoSchedule}','${org}','${bravoCampaign}','${bravo}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code,published_revision,published_at)
        values ('${yesterday}','${org}','${bravoSchedule}',(now() at time zone 'Europe/Paris')::date - 1,'DAY',1,now() - interval '3 days');
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
        values ('${org}','${yesterday}','${bob}',1,'CONFIRMED','${chef}');
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount)
        values ('${org}','${bravoCampaign}',(now() at time zone 'Europe/Paris')::date - 1,'DAY',1);
      set session_replication_role = origin;`);
    // Le besoin est relevé après coup : la photographie se prend d'abord.
    await live.query("update public.staffing_requirements set headcount=2 where campaign_id=$1", [bravoCampaign]);
    expect(
      await rows(
        "select source, headcount_required, effective_count, covered from private.shift_start_facts where schedule_shift_id=$1",
        [yesterday],
      ),
    ).toEqual([{ source: "modification", headcount_required: 1, effective_count: 1, covered: true }]);
    expect(
      await rows("select headcount from public.staffing_requirements where campaign_id=$1", [bravoCampaign]),
    ).toEqual([{ headcount: 2 }]);
  });

  it("retire les détails d’un compte et garde les faits, une fois les photographies dues prises", async () => {
    // La campagne Bravo vient de fermer ; aucun passage ne l'a encore prise.
    await live.exec("reset role");
    await live.query("update public.availability_campaigns set closes_at = now() - interval '1 minute' where id=$1", [
      bravoCampaign,
    ]);
    const facts = () =>
      rows("select schedule_shift_id, revision, assigned_count, holders from private.publication_facts order by id");
    const before = await facts();
    await live.exec(
      provisioningScript("retirer-un-compte.sql").replace("'agent.qui.part@exemple.fr'", "'bob@photos.test'"),
    );
    // Bravo a été photographiée avant le retrait : Bob y était attendu.
    expect(
      await rows("select source, participants, expected from private.closure_facts where campaign_id=$1", [
        bravoCampaign,
      ]),
    ).toEqual([{ source: "script", participants: 1, expected: 1 }]);
    expect(
      await rows("select participants, expected, validated from private.closure_facts where campaign_id=$1", [
        campaign,
      ]),
    ).toEqual([{ participants: 3, expected: 3, validated: 2 }]);
    expect(await facts()).toEqual(before);
    for (const table of ["publication_assignees", "closure_participants"])
      expect(await rows(`select count(*)::int as n from private.${table} where user_id=$1`, [bob]), table).toEqual([
        { n: 0 },
      ]);
  });

  it("rend dans l’export d’un compte ce que les photographies ont retenu de lui", async () => {
    const sql = provisioningScript("exporter-les-donnees-d-un-compte.sql").replace(
      "'agent@exemple.fr'",
      "'alice@photos.test'",
    );
    const data = JSON.parse((await rows<{ donnees: string }>(sql))[0].donnees);
    expect(data.photographies_publication.map((p: { version: number }) => p.version)).toEqual([1, 2]);
    expect(data.photographies_publication[0]).toMatchObject({ role: "AGENT", qualifications: ["INC1"] });
    expect(data.photographies_cloture).toEqual([
      expect.objectContaining({ campagne: "Novembre", attendu: true, role: "AGENT" }),
    ]);
    // L'inventaire du centre compte aussi les photographies.
    const inventory = await rows<{ objet: string }>(provisioningScript("inventaire-du-centre.sql").split(";")[0]);
    expect(inventory.map(r => r.objet)).toContain("photographies de publication");
  });

  it("purge détails et faits à leur échéance, chacun la sienne", async () => {
    const old = "60000000-0000-0000-0000-0000000000ef";
    const oldCampaign = "40000000-0000-0000-0000-0000000000ef";
    const seed = () =>
      live.exec(`
        reset role;
        insert into private.publication_facts(organization_id,team_id,team_name,campaign_id,schedule_shift_id,date,shift_code,
          starts_at,ends_at,revision,published_at,headcount_required,assigned_count)
          values ('${org}','${team}','Alpha','${oldCampaign}','${old}','2023-01-15','DAY','2023-01-15 07:00+00',
                  '2023-01-15 19:00+00',1,'2023-01-10',1,1);
        insert into private.publication_assignees(publication_id,organization_id,user_id,role,team_id)
          select id,'${org}','${alice}','AGENT','${team}' from private.publication_facts where schedule_shift_id='${old}';
        insert into private.closure_facts(campaign_id,organization_id,team_id,team_name,campaign_name,starts_on,ends_on,
          closes_at,taken_at,source,rule,participants,expected,validated)
          values ('${oldCampaign}','${org}','${team}','Alpha','Janvier 2023','2023-01-01','2023-01-31','2022-12-31',
                  '2022-12-31','passage','règle',1,1,1);
        insert into private.closure_participants(campaign_id,organization_id,user_id,role,active,team_id,expected)
          values ('${oldCampaign}','${org}','${alice}','AGENT',true,'${team}',true);`);
    const count = async (table: string, where: string) =>
      (await rows<{ n: number }>(`select count(*)::int as n from private.${table} where ${where}`))[0].n;
    // Par défaut, les faits suivent la durée des campagnes.
    await seed();
    await live.exec(provisioningScript("purger-les-donnees-anciennes.sql"));
    expect(await count("publication_facts", `schedule_shift_id='${old}'`)).toBe(0);
    expect(await count("closure_facts", `campaign_id='${oldCampaign}'`)).toBe(0);
    expect(await count("publication_facts", `schedule_shift_id='${day1}'`)).toBe(2);
    // Une durée des faits allongée, le jour où le DPO l'aura décidé : les
    // détails partent, les faits restent.
    await seed();
    await live.exec(
      provisioningScript("purger-les-donnees-anciennes.sql").replace(
        "duree_faits constant interval := '24 months'",
        "duree_faits constant interval := '60 months'",
      ),
    );
    expect(await count("publication_facts", `schedule_shift_id='${old}'`)).toBe(1);
    expect(await count("closure_facts", `campaign_id='${oldCampaign}'`)).toBe(1);
    expect(
      await count(
        "publication_assignees",
        `publication_id in (select id from private.publication_facts where schedule_shift_id='${old}')`,
      ),
    ).toBe(0);
    expect(await count("closure_participants", `campaign_id='${oldCampaign}'`)).toBe(0);
    // Les détails récents restent.
    expect(await count("closure_participants", `campaign_id='${campaign}'`)).toBe(2);
  });

  it("ne s’ouvre à aucune session", async () => {
    await be(chef);
    for (const table of [
      "publication_facts",
      "publication_assignees",
      "closure_facts",
      "closure_participants",
      "shift_start_facts",
    ])
      await expect(live.query(`select * from private.${table}`), table).rejects.toThrow();
    await live.exec("reset role");
    await be(chef);
    await expect(live.query("select private.take_due_snapshots(now())")).rejects.toThrow();
    await live.exec("reset role");
  });
});

describe("Migration 20261020150000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261020150000_photographies.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261020090000_traitements_planifies.sql");
    await early.close();
  }, 90000);
});

// Lot B (20 octobre) : publier le mois. Un aperçu qui classe chaque créneau,
// une publication des seuls créneaux prêts en une transaction, refusée sur un
// aperçu périmé et jamais rejouée, et un seul avis par agent concerné.
describe("Publication du mois", () => {
  const org = "10000000-0000-0000-0000-0000000000f1";
  const other = "10000000-0000-0000-0000-0000000000f2";
  const team = "20000000-0000-0000-0000-0000000000f1";
  const otherTeam = "20000000-0000-0000-0000-0000000000f2";
  const chef = "30000000-0000-0000-0000-0000000000f0";
  const a1 = "30000000-0000-0000-0000-0000000000f1";
  const a2 = "30000000-0000-0000-0000-0000000000f2";
  const a3 = "30000000-0000-0000-0000-0000000000f3";
  const a4 = "30000000-0000-0000-0000-0000000000f4";
  const outsider = "30000000-0000-0000-0000-0000000000f9";
  const campaign = "40000000-0000-0000-0000-0000000000f1";
  const schedule = "50000000-0000-0000-0000-0000000000f1";
  const inc = "70000000-0000-0000-0000-0000000000f1";
  // Huit créneaux, du 1er au 4 novembre 2026.
  const slot = (n: number) => `60000000-0000-0000-0000-0000000000f${n}`;
  const [day1, night1, day2, night2, day3, night3, day4, night4] = [1, 2, 3, 4, 5, 6, 7, 8].map(slot);
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  type Preview = {
    fingerprint: string;
    counts: { total: number; ready: number; blocked: number; unchanged: number };
    shifts: { id: string; date: string; shift: string; state: string; revision: number; reasons: { code: string }[] }[];
  };
  const preview = async (as = chef) => {
    await be(as);
    return (await live.query<{ p: Preview }>("select public.month_publication_preview($1) as p", [campaign])).rows[0].p;
  };
  const publish = async (fingerprint: string, request: string, as = chef) => {
    await be(as);
    return (
      await live.query<{ r: { published: number; notices: number; replayed?: boolean } }>(
        "select public.publish_month($1, $2, $3) as r",
        [campaign, fingerprint, request],
      )
    ).rows[0].r;
  };
  const revisions = async () => {
    await live.exec("reset role");
    return Object.fromEntries(
      (
        await live.query<{ id: string; published_revision: number }>(
          "select id, published_revision from public.schedule_shifts where schedule_id=$1",
          [schedule],
        )
      ).rows.map(r => [r.id, r.published_revision]),
    );
  };
  const notices = async () => {
    await live.exec("reset role");
    return (
      await live.query<{ user_id: string; subject: string; body: string; event_key: string | null }>(
        "select user_id, subject, body, event_key from public.notifications where kind='SCHEDULE_PUBLISHED' order by created_at, user_id",
      )
    ).rows;
  };
  const draft = async (shift: string, user: string) => {
    await be(chef);
    await live.query(
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [org, shift, user, chef],
    );
  };

  beforeAll(async () => {
    live = await freshDatabase();
    const agents = [a1, a2, a3, a4];
    await live.exec(`
      insert into auth.users(id) values ('${chef}'), ('${a1}'), ('${a2}'), ('${a3}'), ('${a4}'), ('${outsider}');
      insert into public.profiles(user_id,display_name) values ('${chef}','Chef'), ('${a1}','Agent Un'),
        ('${a2}','Agent Deux'), ('${a3}','Agent Trois'), ('${a4}','Agent Quatre'), ('${outsider}','Ailleurs');
      insert into public.organizations(id,name) values ('${org}','Centre du mois'), ('${other}','Autre centre');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha'), ('${otherTeam}','${other}','Alpha');
      insert into public.memberships values ('${org}','${chef}','${team}','GESTIONNAIRE',true),
        ${agents.map(a => `('${org}','${a}','${team}','AGENT',true)`).join(", ")},
        ('${other}','${outsider}','${otherTeam}','GESTIONNAIRE',true);
      insert into public.qualifications(id,organization_id,name) values ('${inc}','${org}','INC1');
      insert into public.user_qualifications(organization_id,user_id,qualification_id) values
        ('${org}','${a1}','${inc}'), ('${org}','${a2}','${inc}');
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Novembre','2026-11-01','2026-11-30',now()-interval '10 days',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ${agents.map(a => `('${org}','${campaign}','${a}')`).join(", ")};
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code) values
        ('${day1}','${org}','${schedule}','2026-11-01','DAY'), ('${night1}','${org}','${schedule}','2026-11-01','NIGHT'),
        ('${day2}','${org}','${schedule}','2026-11-02','DAY'), ('${night2}','${org}','${schedule}','2026-11-02','NIGHT'),
        ('${day3}','${org}','${schedule}','2026-11-03','DAY'), ('${night3}','${org}','${schedule}','2026-11-03','NIGHT'),
        ('${day4}','${org}','${schedule}','2026-11-04','DAY'), ('${night4}','${org}','${schedule}','2026-11-04','NIGHT');
      -- Pas de besoin le 2 au Jour.
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount) values
        ('${org}','${campaign}','2026-11-01','DAY',2), ('${org}','${campaign}','2026-11-01','NIGHT',2),
        ('${org}','${campaign}','2026-11-02','NIGHT',1), ('${org}','${campaign}','2026-11-03','DAY',1),
        ('${org}','${campaign}','2026-11-03','NIGHT',2), ('${org}','${campaign}','2026-11-04','DAY',1),
        ('${org}','${campaign}','2026-11-04','NIGHT',1);
      set session_replication_role = replica;
      insert into public.availability_entries(campaign_id,user_id,date,availability_type)
        select '${campaign}', u, d::date, 'FULL_24H'
          from unnest(array['${agents.join("','")}']::uuid[]) u, generate_series('2026-11-01'::date, '2026-11-04', '1 day') d;
      update public.campaign_participants set validated_at = now() - interval '1 hour';
      -- Déjà publiés en version 1 : le 2 à la Nuit (Quatre), le 3 au Jour
      -- (Trois), le 3 à la Nuit (Un et Quatre).
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by) values
        ('${org}','${night2}','${a4}',1,'CONFIRMED','${chef}'), ('${org}','${day3}','${a3}',1,'CONFIRMED','${chef}'),
        ('${org}','${night3}','${a1}',1,'CONFIRMED','${chef}'), ('${org}','${night3}','${a4}',1,'CONFIRMED','${chef}');
      update public.schedule_shifts set published_revision=1, published_at=now()-interval '2 days'
       where id in ('${night2}','${day3}','${night3}');
      set session_replication_role = origin;`);
    // Les brouillons : prêt, incomplet, vide, identique, modifié, incomplet, prêts.
    for (const [shift, users] of [
      [day1, [a1, a2]],
      [night1, [a3]],
      [night2, [a4]],
      [day3, [a2]],
      [night3, [a1]],
      [day4, [a2]],
      [night4, [a2]],
    ] as const)
      for (const user of users) await draft(shift, user);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("classe chaque créneau : prêt, bloqué avec ses raisons, ou inchangé", async () => {
    const p = await preview();
    expect(p.counts).toEqual({ total: 8, ready: 4, blocked: 3, unchanged: 1 });
    const state = Object.fromEntries(p.shifts.map(s => [s.id, s.state]));
    expect(state).toEqual({
      [day1]: "ready",
      [night1]: "blocked",
      [day2]: "blocked",
      [night2]: "unchanged",
      [day3]: "ready",
      [night3]: "blocked",
      [day4]: "ready",
      [night4]: "ready",
    });
    const reasons = Object.fromEntries(p.shifts.map(s => [s.id, s.reasons]));
    expect(reasons[night1]).toEqual([{ code: "headcount", assigned: 1, required: 2 }]);
    expect(reasons[day2]).toEqual([{ code: "requirement" }]);
    expect(reasons[night3]).toEqual([{ code: "headcount", assigned: 1, required: 2 }]);
    // L'ordre du calendrier, et rien des brouillons.
    expect(p.shifts.map(s => `${s.date} ${s.shift}`)).toEqual([
      "2026-11-01 DAY",
      "2026-11-01 NIGHT",
      "2026-11-02 DAY",
      "2026-11-02 NIGHT",
      "2026-11-03 DAY",
      "2026-11-03 NIGHT",
      "2026-11-04 DAY",
      "2026-11-04 NIGHT",
    ]);
    expect(JSON.stringify(p)).not.toContain(a1);
  });

  it("publie les seuls créneaux prêts, en une fois, et garde la version publiée des autres", async () => {
    const p = await preview();
    expect(await publish(p.fingerprint, "90000000-0000-0000-0000-0000000000f1")).toEqual({ published: 4, notices: 3 });
    expect(await revisions()).toEqual({
      [day1]: 1,
      [night1]: 0,
      [day2]: 0,
      [night2]: 1,
      [day3]: 2,
      [night3]: 1,
      [day4]: 1,
      [night4]: 1,
    });
    // Le 3 à la Nuit reste publié tel qu'il l'était : Un et Quatre.
    await live.exec("reset role");
    expect(
      (
        await live.query<{ user_id: string }>(
          "select user_id from public.schedule_assignments where schedule_shift_id=$1 and revision=1 order by user_id",
          [night3],
        )
      ).rows.map(r => r.user_id),
    ).toEqual([a1, a4]);
    expect(
      (
        await live.query<{ action: string; new_value: Record<string, unknown> }>(
          "select action, new_value from public.audit_logs where entity='availability_campaign' and action='PUBLISH_MONTH'",
        )
      ).rows,
    ).toEqual([{ action: "PUBLISH_MONTH", new_value: { name: "Novembre", published: 4, notices: 3 } }]);
  });

  it("prévient une fois chaque agent dont les gardes changent, avec dates et horaires, et lui seul", async () => {
    const sent = await notices();
    // Trois avis : Un et Deux gagnent des gardes, Trois perd la sienne. Pas
    // d'avis par créneau, ni pour Quatre, dont rien n'a changé.
    expect(sent.map(n => n.user_id).sort()).toEqual([a1, a2, a3]);
    const of = (user: string) => sent.find(n => n.user_id === user)!;
    expect(of(a2)).toMatchObject({
      subject: "Planning de novembre 2026 publié",
      body:
        "Gardes ajoutées :\n" +
        "– dimanche 1 novembre, de 8 h à 20 h\n" +
        "– mardi 3 novembre, de 8 h à 20 h\n" +
        "– mercredi 4 novembre, de 8 h à 8 h le lendemain (24 h)",
    });
    expect(of(a1).body).toBe("Gardes ajoutées :\n– dimanche 1 novembre, de 8 h à 20 h");
    // Un retrait total reçoit son avis.
    expect(of(a3)).toMatchObject({
      subject: "Planning de novembre 2026 modifié",
      body: "Gardes retirées :\n– mardi 3 novembre, de 8 h à 20 h",
    });
    expect(sent.some(n => n.user_id === a4)).toBe(false);
    for (const n of sent) {
      expect(n.event_key).toMatch(/^month-publication:/);
      expect(n.body).not.toMatch(/Agent (Un|Deux|Trois|Quatre)/);
    }
  });

  it("rejoue une demande déjà traitée sans rien republier ni renvoyer", async () => {
    const before = { revisions: await revisions(), notices: (await notices()).length };
    // Le double clic, la reprise réseau : la même demande, la même empreinte.
    expect(await publish("ignorée", "90000000-0000-0000-0000-0000000000f1")).toEqual({
      published: 4,
      notices: 3,
      replayed: true,
    });
    expect(await revisions()).toEqual(before.revisions);
    expect((await notices()).length).toBe(before.notices);
  });

  it("refuse un aperçu périmé, sans rien publier", async () => {
    const stale = await preview();
    // Un second gestionnaire complète la Nuit du 1er entre l'aperçu et la confirmation.
    await draft(night1, a1);
    await expect(publish(stale.fingerprint, "90000000-0000-0000-0000-0000000000f2")).rejects.toThrow(
      "Month preview is stale",
    );
    expect((await revisions())[night1]).toBe(0);
    // L'aperçu relu la montre prête : elle se publie, et l'avis dit la nuit.
    const fresh = await preview();
    expect(fresh.counts.ready).toBe(1);
    expect(await publish(fresh.fingerprint, "90000000-0000-0000-0000-0000000000f3")).toEqual({
      published: 1,
      notices: 2,
    });
    const last = (await notices()).filter(n => n.event_key?.includes("0000000000f3"));
    expect(last.find(n => n.user_id === a1)?.body).toBe(
      "Gardes ajoutées :\n– dimanche 1 novembre, de 20 h à 8 h le lendemain",
    );
  });

  it("dit qu’aucun créneau n’est prêt, et ne publie rien", async () => {
    const p = await preview();
    expect(p.counts).toMatchObject({ ready: 0, blocked: 2 });
    await expect(publish(p.fingerprint, "90000000-0000-0000-0000-0000000000f4")).rejects.toThrow(
      "Nothing ready to publish",
    );
  });

  it("annule toute l’opération si un créneau échoue en cours de route", async () => {
    // Deux créneaux prêts ; le second casse au moment d'être publié.
    await live.exec("reset role");
    await live.query(
      "insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount) values ($1,$2,'2026-11-02','DAY',1)",
      [org, campaign],
    );
    // Des affectations qui respectent le repos (décision du 21 octobre) : Deux
    // le 2 au Jour après son Jour du 1er, Trois le 3 à la Nuit après sa Nuit du 1er.
    await draft(day2, a2);
    await draft(night3, a3);
    await live.exec(`
      reset role;
      create function public.casse_la_publication() returns trigger language plpgsql as $$
        begin raise exception 'Panne au milieu du mois'; end $$;
      create trigger casse_la_publication before update of published_revision on public.schedule_shifts
        for each row when (new.id = '${night3}') execute function public.casse_la_publication();`);
    const p = await preview();
    expect(p.counts.ready).toBe(2);
    const before = { revisions: await revisions(), notices: (await notices()).length };
    await expect(publish(p.fingerprint, "90000000-0000-0000-0000-0000000000f5")).rejects.toThrow(
      "Panne au milieu du mois",
    );
    expect(await revisions()).toEqual(before.revisions);
    expect((await notices()).length).toBe(before.notices);
    await live.exec(`
      reset role;
      drop trigger casse_la_publication on public.schedule_shifts;
      drop function public.casse_la_publication();`);
    // La même demande, une fois la panne passée, n'a rien laissé derrière elle.
    // Trois avis : Trois et Deux gagnent une garde, Quatre perd la Nuit du 3.
    expect(await publish(p.fingerprint, "90000000-0000-0000-0000-0000000000f5")).toEqual({
      published: 2,
      notices: 3,
    });
  });

  it("ne s’ouvre ni à un agent ni au gestionnaire d’un autre centre", async () => {
    for (const who of [a1, outsider]) {
      await expect(preview(who)).rejects.toThrow("Not allowed to publish this schedule");
      await expect(publish("x", "90000000-0000-0000-0000-0000000000f6", who)).rejects.toThrow(
        "Not allowed to publish this schedule",
      );
    }
    await live.exec("reset role");
  });

  it("partage avec la publication unitaire les mêmes règles et les mêmes refus", async () => {
    // Le 3 à la Nuit, bloqué dans l'aperçu, refusé à l'unité avec le même motif.
    await be(chef);
    await live.query(
      "delete from public.schedule_assignments where schedule_shift_id=$1 and revision=0 and user_id=$2",
      [night3, a3],
    );
    const blocked = (await preview()).shifts.find(s => s.id === night3);
    expect(blocked?.reasons).toEqual([{ code: "headcount", assigned: 1, required: 2 }]);
    await be(chef);
    await expect(live.query("select public.publish_shift($1)", [night3])).rejects.toThrow(
      "Headcount not covered: 1 of 2",
    );
    await live.exec("reset role");
  });
});

describe("Migration 20261020200000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261020200000_publication_du_mois.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261020150000_photographies.sql");
    await early.close();
  }, 90000);
});

// Lot C (21 octobre) : la règle de repos du centre, puis les appels à
// remplacement et à renfort. Les gardes sont prises le mois prochain : un appel
// exige une garde à venir, et des dates fixes vieilliraient.
describe("Règle de repos — autant de repos que la garde a duré", () => {
  const org = "10000000-0000-0000-0000-0000000000c1";
  const team = "20000000-0000-0000-0000-0000000000c1";
  const chef = "30000000-0000-0000-0000-0000000000c0";
  const nuit = "30000000-0000-0000-0000-0000000000c1";
  const vingtQuatre = "30000000-0000-0000-0000-0000000000c2";
  const campaign = "40000000-0000-0000-0000-0000000000c1";
  const schedule = "50000000-0000-0000-0000-0000000000c1";
  // Six jours, Jour et Nuit : slot(jour, "D"|"N").
  const slot = (day: number, code: "D" | "N") => `60000000-0000-0000-0000-0000000000${code === "D" ? "d" : "e"}${day}`;
  let live: PGlite;
  const violation = async (member: string, shift: string, extra: string[] = []) =>
    (
      await live.query<{ v: string | null }>("select private.rest_violation($1, $2, $3::uuid[]) as v", [
        member,
        shift,
        extra,
      ])
    ).rows[0].v;
  const published = async (shift: string, user: string) => {
    await live.exec(`
      set session_replication_role = replica;
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
        values ('${org}','${shift}','${user}',1,'CONFIRMED','${chef}');
      update public.schedule_shifts set published_revision=1, published_at=now() where id='${shift}';
      set session_replication_role = origin;`);
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${chef}'), ('${nuit}'), ('${vingtQuatre}');
      insert into public.profiles(user_id,display_name) values ('${chef}','Chef'), ('${nuit}','Agent Nuit'),
        ('${vingtQuatre}','Agent Vingt-Quatre');
      insert into public.organizations(id,name) values ('${org}','Centre repos');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${chef}','${team}','GESTIONNAIRE',true),
        ('${org}','${nuit}','${team}','AGENT',true), ('${org}','${vingtQuatre}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        select '${campaign}','${org}','${team}','Mois prochain', m, (m + interval '1 month - 1 day')::date,
               now()-interval '10 days', now()+interval '1 day'
          from (select date_trunc('month', (now() at time zone 'Europe/Paris')::date + interval '1 month')::date as m) t;
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        select ('60000000-0000-0000-0000-0000000000' || case when code = 'DAY' then 'd' else 'e' end || d)::uuid,
               '${org}', '${schedule}', c.starts_on + d, code
          from public.availability_campaigns c, generate_series(1, 6) d, unnest(array['DAY','NIGHT']) code
         where c.id = '${campaign}';`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("refuse le Jour qui suit une Nuit, et accepte le Jour d’après", async () => {
    await published(slot(1, "N"), nuit);
    // La Nuit finit à 8 h : le Jour qui commence à 8 h n'a aucun repos.
    expect(await violation(nuit, slot(2, "D"))).toMatch(/^garde du \d\d\/\d\d, Nuit$/);
    // La Nuit du lendemain commence 12 h après : 12 h de repos, le compte y est.
    expect(await violation(nuit, slot(2, "N"))).toBeNull();
    // Une garde contiguë qui la précède : le Jour de la même date, qui ferait un 24 h.
    expect(await violation(nuit, slot(1, "D"))).toBeNull();
  });

  it("tient le Jour et la Nuit d’une même date pour 24 h, et exige 24 h de repos ensuite", async () => {
    await published(slot(3, "D"), vingtQuatre);
    await published(slot(3, "N"), vingtQuatre);
    // Le 24 h finit le lendemain à 8 h : 24 h de repos, jusqu'au surlendemain 8 h.
    expect(await violation(vingtQuatre, slot(4, "D"))).toMatch(/24 h$/);
    expect(await violation(vingtQuatre, slot(4, "N"))).toMatch(/24 h$/);
    expect(await violation(vingtQuatre, slot(5, "D"))).toBeNull();
  });

  it("refuse la publication unitaire en nommant l’agent et la garde en cause", async () => {
    await live.exec(`
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount)
        select '${org}', '${campaign}', date, 'DAY', 1 from public.schedule_shifts where id = '${slot(2, "D")}';
      set session_replication_role = replica;
      insert into public.availability_entries(campaign_id,user_id,date,availability_type)
        select '${campaign}', '${nuit}', date, 'FULL_24H' from public.schedule_shifts where id = '${slot(2, "D")}';
      insert into public.campaign_participants(organization_id,campaign_id,user_id,validated_at)
        values ('${org}','${campaign}','${nuit}',now());
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
        values ('${org}','${slot(2, "D")}','${nuit}',0,'PROPOSED','${chef}');
      set session_replication_role = origin;
      select set_config('request.jwt.claim.sub', '${chef}', false);
      set role authenticated;`);
    await expect(live.query("select public.publish_shift($1)", [slot(2, "D")])).rejects.toThrow(
      /^Rest not respected: Agent Nuit \(garde du \d\d\/\d\d, Nuit\)$/,
    );
    await live.exec("reset role");
  });

  it("juge le mois avec les brouillons qu’il publie ensemble", async () => {
    // Deux brouillons du mois incompatibles se bloquent ; un brouillon qu'on ne
    // publie pas ne compte pas.
    await live.exec(`
      set session_replication_role = replica;
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by)
        values ('${org}','${slot(5, "N")}','${nuit}',0,'PROPOSED','${chef}'),
               ('${org}','${slot(6, "D")}','${nuit}',0,'PROPOSED','${chef}');
      set session_replication_role = origin;`);
    expect(await violation(nuit, slot(6, "D"))).toBeNull();
    expect(await violation(nuit, slot(6, "D"), [slot(5, "N"), slot(6, "D")])).toMatch(
      /^brouillon du \d\d\/\d\d, Nuit$/,
    );
  });
});

describe("Appels à remplacement et à renfort", () => {
  const org = "10000000-0000-0000-0000-0000000000c5";
  const other = "10000000-0000-0000-0000-0000000000c6";
  const team = "20000000-0000-0000-0000-0000000000c5";
  const bravo = "20000000-0000-0000-0000-0000000000c6";
  const otherTeam = "20000000-0000-0000-0000-0000000000c7";
  const chef = "30000000-0000-0000-0000-0000000000a0";
  const [a1, a2, a3, a4, a5, a6] = [1, 2, 3, 4, 5, 6].map(n => `30000000-0000-0000-0000-0000000000a${n}`);
  const b1 = "30000000-0000-0000-0000-0000000000b1";
  const outsider = "30000000-0000-0000-0000-0000000000b9";
  const campaign = "40000000-0000-0000-0000-0000000000c5";
  const schedule = "50000000-0000-0000-0000-0000000000c5";
  const inc = "70000000-0000-0000-0000-0000000000c1";
  const cod = "70000000-0000-0000-0000-0000000000c2";
  const slot = (day: number, code: "D" | "N") => `60000000-0000-0000-0000-0000000001${code === "D" ? "d" : "e"}${day}`;
  const TERMS = "declaration-2026-10-21";
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const as = async <T>(id: string, sql: string, params: unknown[] = []) => {
    await be(id);
    try {
      return (await live.query<T>(sql, params)).rows;
    } finally {
      await live.exec("reset role");
    }
  };
  const rows = async <T>(sql: string, params: unknown[] = []) => {
    await live.exec("reset role");
    return (await live.query<T>(sql, params)).rows;
  };
  const one = async <T>(id: string, sql: string, params: unknown[] = []) => (await as<T>(id, sql, params))[0];
  const openCall = async (shift: string, withdrawal: string | null = null) =>
    (await one<{ id: string }>(chef, "select public.open_call($1, $2) as id", [shift, withdrawal])).id;
  const propose = (who: string, call: string, declared = false, terms: string | null = null) =>
    as(who, "select public.propose_for_call($1, $2, $3)", [call, declared, terms]);
  const proposalOf = async (call: string, user: string) =>
    (
      await rows<{ id: string; state: string; declared: boolean }>(
        "select id, state, declared from public.call_proposals where call_id=$1 and user_id=$2 order by proposed_at desc limit 1",
        [call, user],
      )
    )[0];
  const draftOf = async (shift: string) =>
    (
      await rows<{ user_id: string }>(
        "select user_id from public.schedule_assignments where schedule_shift_id=$1 and revision=0 order by user_id",
        [shift],
      )
    ).map(r => r.user_id);
  const notices = async (kind: string, user: string) =>
    rows<{ subject: string; body: string; email_status: string }>(
      "select subject, body, email_status from public.notifications where kind=$1 and user_id=$2 order by created_at",
      [kind, user],
    );

  beforeAll(async () => {
    live = await freshDatabase();
    const alpha = [a1, a2, a3, a4, a5, a6];
    await live.exec(`
      insert into auth.users(id) values ('${chef}'), ${alpha.map(a => `('${a}')`).join(", ")}, ('${b1}'), ('${outsider}');
      insert into public.profiles(user_id,display_name) values ('${chef}','Chef'),
        ${alpha.map((a, i) => `('${a}','Agent ${["Un", "Deux", "Trois", "Quatre", "Cinq", "Six"][i]}')`).join(", ")},
        ('${b1}','Agent Bravo'), ('${outsider}','Ailleurs');
      insert into public.organizations(id,name) values ('${org}','Centre appels'), ('${other}','Autre centre');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha'), ('${bravo}','${org}','Bravo'),
        ('${otherTeam}','${other}','Alpha');
      insert into public.memberships values ('${org}','${chef}','${team}','GESTIONNAIRE',true),
        ${alpha.map(a => `('${org}','${a}','${team}','AGENT',true)`).join(", ")},
        ('${org}','${b1}','${bravo}','AGENT',true), ('${other}','${outsider}','${otherTeam}','GESTIONNAIRE',true);
      insert into public.qualifications(id,organization_id,name) values ('${inc}','${org}','INC1'), ('${cod}','${org}','COD2');
      insert into public.user_qualifications(organization_id,user_id,qualification_id) values
        ('${org}','${a1}','${inc}'), ('${org}','${a2}','${inc}'), ('${org}','${a3}','${inc}'), ('${org}','${a4}','${cod}');
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        select '${campaign}','${org}','${team}','Mois prochain', m, (m + interval '1 month - 1 day')::date,
               now()-interval '10 days', now()+interval '1 day'
          from (select date_trunc('month', (now() at time zone 'Europe/Paris')::date + interval '1 month')::date as m) t;
      insert into public.campaign_participants(organization_id,campaign_id,user_id)
        select '${org}', '${campaign}', u from unnest(array['${alpha.join("','")}']::uuid[]) u;
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        select ('60000000-0000-0000-0000-0000000001' || case when code = 'DAY' then 'd' else 'e' end || d)::uuid,
               '${org}', '${schedule}', c.starts_on + d, code
          from public.availability_campaigns c, generate_series(1, 6) d, unnest(array['DAY','NIGHT']) code
         where c.id = '${campaign}';
      insert into public.staffing_requirements(organization_id,campaign_id,date,shift_code,headcount)
        select '${org}', '${campaign}', s.date, s.shift_code, 2 from public.schedule_shifts s where s.schedule_id = '${schedule}';
      -- Un, Deux, Trois et Quatre ont validé une disponibilité 24 h sur les six
      -- jours ; Cinq et Six n'ont rien validé.
      set session_replication_role = replica;
      insert into public.availability_entries(campaign_id,user_id,date,availability_type)
        select '${campaign}', u, s.date, 'FULL_24H'
          from unnest(array['${a1}','${a2}','${a3}','${a4}']::uuid[]) u,
               (select distinct date from public.schedule_shifts where schedule_id = '${schedule}') s;
      update public.campaign_participants set validated_at = now() - interval '1 hour'
       where user_id in ('${a1}','${a2}','${a3}','${a4}');
      -- Publié : Un et Deux le 2 au Jour.
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by) values
        ('${org}','${slot(2, "D")}','${a1}',0,'PROPOSED','${chef}'), ('${org}','${slot(2, "D")}','${a2}',0,'PROPOSED','${chef}'),
        ('${org}','${slot(2, "D")}','${a1}',1,'CONFIRMED','${chef}'), ('${org}','${slot(2, "D")}','${a2}',1,'CONFIRMED','${chef}');
      update public.schedule_shifts set published_revision=1, published_at=now()-interval '1 day' where id='${slot(2, "D")}';
      set session_replication_role = origin;`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  let call: string;

  it("accepte le désistement et ouvre l’appel, en une fois, vers les seuls disponibles de l’équipe", async () => {
    const [withdrawal] = await as<{ id: string }>(
      a1,
      "insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason) values ($1,$2,$3,'Motif privé') returning id",
      [org, slot(2, "D"), a1],
    );
    const preview = await one<{ p: Record<string, unknown> }>(chef, "select public.call_preview($1, $2) as p", [
      slot(2, "D"),
      withdrawal.id,
    ]);
    expect(preview.p).toMatchObject({
      need: { required: 2, kept: 1, missing_headcount: 1, missing_qualifications: [] },
      available: 2,
      widened: 2,
      open: false,
    });
    call = await openCall(slot(2, "D"), withdrawal.id);
    expect(await rows("select state from public.shift_withdrawals where id=$1", [withdrawal.id])).toEqual([
      { state: "ACCEPTED" },
    ]);
    // Un sort du brouillon ; la version publiée garde son nom.
    expect(await draftOf(slot(2, "D"))).toEqual([a2]);
    expect(
      (
        await rows<{ user_id: string; circle: string }>(
          "select user_id, circle from public.call_recipients where call_id=$1 order by user_id",
          [call],
        )
      ).map(r => `${r.user_id}:${r.circle}`),
    ).toEqual([`${a3}:AVAILABLE`, `${a4}:AVAILABLE`]);
    const [sollicitation] = await notices("CALL_OPENED", a3);
    expect(sollicitation.subject).toMatch(/^Garde à pourvoir — /);
    expect(sollicitation.body).toMatch(/de 8 h à 20 h/);
    expect(sollicitation.body).not.toMatch(/Agent Un|Motif privé/);
    expect(await notices("CALL_OPENED", a1)).toEqual([]);
    await expect(openCall(slot(2, "D"))).rejects.toThrow("A call is already open for this shift");
  });

  it("enregistre la proposition sans rien affecter, et la refuse à qui n’est pas sollicité", async () => {
    await propose(a3, call);
    expect(await proposalOf(call, a3)).toMatchObject({ state: "PENDING", declared: false });
    expect(await draftOf(slot(2, "D"))).toEqual([a2]);
    await expect(propose(a3, call)).rejects.toThrow("You have already offered for this call");
    for (const who of [a5, b1, a1]) await expect(propose(who, call)).rejects.toThrow("Not eligible for this call");
  });

  it("élargit l’appel sur geste du gestionnaire, et n’accepte alors qu’une déclaration explicite", async () => {
    expect((await one<{ n: number }>(chef, "select public.widen_call($1) as n", [call])).n).toBe(2);
    expect(await notices("CALL_OPENED", a5)).toHaveLength(1);
    await expect(propose(a5, call)).rejects.toThrow("A declaration of availability is required");
    await expect(propose(a5, call, true, "conditions-anciennes")).rejects.toThrow("The declaration terms have changed");
    await propose(a5, call, true, TERMS);
    expect(await proposalOf(call, a5)).toMatchObject({ state: "PENDING", declared: true });
    // La déclaration ne touche ni à la campagne ni à sa réponse.
    expect(
      await rows("select validated_at from public.campaign_participants where campaign_id=$1 and user_id=$2", [
        campaign,
        a5,
      ]),
    ).toEqual([{ validated_at: null }]);
    expect(await rows("select count(*)::int as n from public.availability_entries where user_id=$1", [a5])).toEqual([
      { n: 0 },
    ]);
  });

  it("retient au brouillon sous contrôle, et refuse le surnombre", async () => {
    await as(chef, "select public.select_proposal($1)", [(await proposalOf(call, a3)).id]);
    expect(await draftOf(slot(2, "D"))).toEqual([a2, a3]);
    expect(await proposalOf(call, a3)).toMatchObject({ state: "SELECTED" });
    await expect(as(chef, "select public.select_proposal($1)", [(await proposalOf(call, a5)).id])).rejects.toThrow(
      "The need of this shift is already covered",
    );
  });

  it("confirme et publie : l’appel se ferme, les autres sont prévenus, les envois inutiles annulés", async () => {
    expect((await one<{ r: number }>(chef, "select public.confirm_call($1) as r", [call])).r).toBe(2);
    expect(await rows("select state, resolved_revision from public.shift_calls where id=$1", [call])).toEqual([
      { state: "RESOLVED", resolved_revision: 2 },
    ]);
    expect(await proposalOf(call, a3)).toMatchObject({ state: "CONFIRMED" });
    expect(await proposalOf(call, a5)).toMatchObject({ state: "DECLINED" });
    const [closed] = await notices("CALL_CLOSED", a5);
    expect(closed.body).toMatch(/n'a pas été retenue/);
    expect(closed.body).not.toMatch(/Agent/);
    // Quatre ne s'était pas proposé : sa sollicitation encore en file ne part plus.
    expect((await notices("CALL_OPENED", a4))[0].email_status).toBe("skipped");
    await expect(as(chef, "select public.confirm_call($1)", [call])).rejects.toThrow("This call is closed");
    // Fermé, l'appel reste lisible de ceux qu'il a sollicités, et refuse toute proposition.
    expect(await as(a4, "select state from public.shift_calls where id=$1", [call])).toEqual([{ state: "RESOLVED" }]);
    await expect(propose(a4, call)).rejects.toThrow("This call is closed");
  });

  it("publie sur déclaration un agent sans disponibilité, et garde la preuve à la republication", async () => {
    // Renfort le 3 à la Nuit : personne au brouillon, deux places.
    const reinforcement = await openCall(slot(3, "N"));
    expect(await rows("select origin, need from public.shift_calls where id=$1", [reinforcement])).toEqual([
      {
        origin: "REINFORCEMENT",
        need: { required: 2, kept: 0, missing_headcount: 2, missing_qualifications: [] },
      },
    ]);
    await as(chef, "select public.widen_call($1)", [reinforcement]);
    await propose(a4, reinforcement);
    await propose(a6, reinforcement, true, TERMS);
    for (const who of [a4, a6])
      await as(chef, "select public.select_proposal($1)", [(await proposalOf(reinforcement, who)).id]);
    expect(await one<{ r: number }>(chef, "select public.confirm_call($1) as r", [reinforcement])).toEqual({ r: 1 });
    expect(await proposalOf(reinforcement, a6)).toMatchObject({ state: "CONFIRMED", declared: true });
    // Republier tel quel, l'appel fermé : la preuve vaut toujours.
    expect(await one<{ r: number }>(chef, "select public.publish_shift($1) as r", [slot(3, "N")])).toEqual({ r: 2 });
    // Retiré du planning, puis réaffecté : la preuve a cessé de valoir.
    await as(chef, "delete from public.schedule_assignments where schedule_shift_id=$1 and user_id=$2 and revision=0", [
      slot(3, "N"),
      a6,
    ]);
    expect(await proposalOf(reinforcement, a6)).toMatchObject({ state: "RELEASED" });
    await as(
      chef,
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [org, slot(3, "N"), a6, chef],
    );
    await expect(as(chef, "select public.publish_shift($1)", [slot(3, "N")])).rejects.toThrow(
      "Every assignment needs a validated matching availability",
    );
  });

  it("retire du brouillon une proposition retirée, et ne la laisse servir à rien", async () => {
    const reinforcement = await openCall(slot(4, "D"));
    await as(chef, "select public.widen_call($1)", [reinforcement]);
    await propose(a5, reinforcement, true, TERMS);
    await as(chef, "select public.select_proposal($1)", [(await proposalOf(reinforcement, a5)).id]);
    expect(await draftOf(slot(4, "D"))).toEqual([a5]);
    await as(a5, "select public.withdraw_proposal($1)", [reinforcement]);
    expect(await proposalOf(reinforcement, a5)).toMatchObject({ state: "WITHDRAWN" });
    expect(await draftOf(slot(4, "D"))).toEqual([]);
    // Réaffecté à la main : sa déclaration retirée ne vaut plus.
    await as(
      chef,
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [org, slot(4, "D"), a5, chef],
    );
    expect(
      (await rows<{ b: { code: string }[] }>("select private.shift_blockers($1) as b", [slot(4, "D")]))[0].b[0],
    ).toMatchObject({
      code: "availability",
    });
    await as(chef, "select public.cancel_call($1)", [reinforcement]);
  });

  it("laisse deux candidats se compléter, et ne sollicite que les utiles", async () => {
    // Le 5 au Jour : deux places, une INC1 et une COD2. Personne ne les a seul.
    await live.exec(`
      insert into public.staffing_requirement_qualifications(organization_id,requirement_id,qualification_id,minimum)
        select '${org}', r.id, q, 1 from public.staffing_requirements r, unnest(array['${inc}','${cod}']::uuid[]) q
         where r.campaign_id = '${campaign}' and r.date = (select date from public.schedule_shifts where id='${slot(5, "D")}')
           and r.shift_code = 'DAY';`);
    const reinforcement = await openCall(slot(5, "D"));
    await propose(a1, reinforcement);
    await propose(a4, reinforcement);
    for (const who of [a1, a4])
      await as(chef, "select public.select_proposal($1)", [(await proposalOf(reinforcement, who)).id]);
    expect(await one<{ r: number }>(chef, "select public.confirm_call($1) as r", [reinforcement])).toEqual({ r: 1 });
    // Une place reste, sans qualification manquante : tout agent est utile. Mais
    // si seule une qualification manque, seuls ses détenteurs sont sollicités.
    await as(chef, "delete from public.schedule_assignments where schedule_shift_id=$1 and user_id=$2 and revision=0", [
      slot(5, "D"),
      a4,
    ]);
    await as(
      chef,
      "insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,assigned_by) values ($1,$2,$3,$4)",
      [org, slot(5, "D"), a2, chef],
    );
    const preview = await one<{ p: { need: Record<string, unknown>; available: number } }>(
      chef,
      "select public.call_preview($1) as p",
      [slot(5, "D")],
    );
    expect(preview.p.need).toMatchObject({ missing_headcount: 0, missing_qualifications: [{ qualification: "COD2" }] });
    // Quatre, seul détenteur de la COD2, avec une disponibilité validée.
    expect(preview.p.available).toBe(1);
  });

  it("voit le changement de disponibilité avant de retenir", async () => {
    const reinforcement = await openCall(slot(6, "D"));
    await propose(a3, reinforcement);
    await live.exec(`
      set session_replication_role = replica;
      update public.availability_entries set availability_type = 'NIGHT'
       where user_id = '${a3}' and date = (select date from public.schedule_shifts where id = '${slot(6, "D")}');
      set session_replication_role = origin;`);
    await expect(
      as(chef, "select public.select_proposal($1)", [(await proposalOf(reinforcement, a3)).id]),
    ).rejects.toThrow("This agent is no longer eligible for this shift");
    await as(chef, "select public.cancel_call($1)", [reinforcement]);
    expect(await rows("select state from public.shift_calls where id=$1", [reinforcement])).toEqual([
      { state: "CANCELLED" },
    ]);
    expect(await proposalOf(reinforcement, a3)).toMatchObject({ state: "DECLINED" });
  });

  it("expire au début de la garde, sans compter comme un remplacement", async () => {
    const reinforcement = await openCall(slot(6, "N"));
    await propose(a4, reinforcement);
    const [{ starts }] = await rows<{ starts: string }>(
      "select (expires_at + interval '1 minute')::text as starts from public.shift_calls where id=$1",
      [reinforcement],
    );
    expect(
      (await rows<{ r: { appels_expires: number } }>("select private.generate_due_notifications($1) as r", [starts]))[0]
        .r.appels_expires,
    ).toBe(1);
    expect(await rows("select state, resolved_revision from public.shift_calls where id=$1", [reinforcement])).toEqual([
      { state: "EXPIRED", resolved_revision: null },
    ]);
    expect(await notices("CALL_CLOSED", a4)).toHaveLength(1);
  });

  it("réserve chaque geste à l’encadrement du centre, et chaque proposition à son agent", async () => {
    for (const who of [a2, outsider]) {
      await expect(as(who, "select public.call_preview($1)", [slot(4, "N")])).rejects.toThrow(
        "Not allowed to call for this shift",
      );
      await expect(as(who, "select public.open_call($1)", [slot(4, "N")])).rejects.toThrow(
        "Not allowed to call for this shift",
      );
    }
    for (const fn of ["widen_call", "cancel_call", "confirm_call"])
      await expect(as(a2, `select public.${fn}($1)`, [call])).rejects.toThrow();
    // Chacun ne lit que ses propositions ; l'appel, s'il l'a sollicité.
    expect(await as(a3, "select distinct user_id from public.call_proposals")).toEqual([{ user_id: a3 }]);
    expect(await as(b1, "select count(*)::int as n from public.shift_calls")).toEqual([{ n: 0 }]);
    // Aucune écriture directe.
    await expect(
      as(a3, "insert into public.call_proposals(call_id,organization_id,user_id) values ($1,$2,$3)", [call, org, a3]),
    ).rejects.toThrow();
  });
});

describe("Migration 20261021090000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261021090000_appels_remplacement.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261020200000_publication_du_mois.sql");
    await early.close();
  }, 90000);
});

// Lot D (21 octobre) : l'agenda abonné. La base ne garde que le condensat du
// jeton ; le flux ne rend que les gardes publiées encore tenues, et rien dès que
// l'abonnement ou l'agent cesse d'y avoir droit.
describe("Agenda abonné", () => {
  const org = "10000000-0000-0000-0000-0000000000d1";
  const team = "20000000-0000-0000-0000-0000000000d1";
  const chef = "30000000-0000-0000-0000-0000000000d0";
  const agent = "30000000-0000-0000-0000-0000000000d1";
  const other = "30000000-0000-0000-0000-0000000000d2";
  const campaign = "40000000-0000-0000-0000-0000000000d1";
  const schedule = "50000000-0000-0000-0000-0000000000d1";
  const slot = (day: number) => `60000000-0000-0000-0000-0000000002d${day}`;
  const hash = (n: number) => String(n).repeat(64).slice(0, 64);
  let live: PGlite;
  const be = async (id: string) => {
    await live.exec("reset role");
    await live.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await live.exec("set role authenticated");
  };
  const as = async <T>(id: string, sql: string, params: unknown[] = []) => {
    await be(id);
    try {
      return (await live.query<T>(sql, params)).rows;
    } finally {
      await live.exec("reset role");
    }
  };
  type Feed = { user_id: string; centre: string; events: { date: string; shift: string; revision: number }[] } | null;
  const feed = async (h: string) => {
    await live.exec("reset role");
    await live.exec("set role service_role");
    try {
      return (await live.query<{ f: Feed }>("select public.calendar_feed_events($1) as f", [h])).rows[0].f;
    } finally {
      await live.exec("reset role");
    }
  };

  beforeAll(async () => {
    live = await freshDatabase();
    await live.exec(`
      insert into auth.users(id) values ('${chef}'), ('${agent}'), ('${other}');
      insert into public.profiles(user_id,display_name) values ('${chef}','Chef'), ('${agent}','Agent'), ('${other}','Autre');
      insert into public.organizations(id,name) values ('${org}','Centre agenda');
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Alpha');
      insert into public.memberships values ('${org}','${chef}','${team}','GESTIONNAIRE',true),
        ('${org}','${agent}','${team}','AGENT',true), ('${org}','${other}','${team}','AGENT',true);
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        select '${campaign}','${org}','${team}','Mois prochain', m, (m + interval '1 month - 1 day')::date,
               now()-interval '10 days', now()+interval '1 day'
          from (select date_trunc('month', (now() at time zone 'Europe/Paris')::date + interval '1 month')::date as m) t;
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        select ('60000000-0000-0000-0000-0000000002d' || d)::uuid, '${org}', '${schedule}', c.starts_on + d, 'DAY'
          from public.availability_campaigns c, generate_series(1, 4) d where c.id = '${campaign}';
      set session_replication_role = replica;
      -- Le 1 : publié pour l'agent. Le 2 : au brouillon seulement. Le 3 : publié,
      -- puis désistement accepté. Le 4 : publié pour un autre.
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by) values
        ('${org}','${slot(1)}','${agent}',1,'CONFIRMED','${chef}'),
        ('${org}','${slot(2)}','${agent}',0,'PROPOSED','${chef}'),
        ('${org}','${slot(3)}','${agent}',1,'CONFIRMED','${chef}'),
        ('${org}','${slot(4)}','${other}',1,'CONFIRMED','${chef}');
      update public.schedule_shifts set published_revision=1, published_at=now()-interval '1 day'
       where id in ('${slot(1)}','${slot(3)}','${slot(4)}');
      insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,state,decided_at,decided_by)
        values ('${org}','${slot(3)}','${agent}','ACCEPTED',now(),'${chef}');
      set session_replication_role = origin;`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("ouvre l’abonnement à l’agent seul, et ne rend jamais le condensat", async () => {
    await as(agent, "select public.create_calendar_feed($1)", [hash(1)]);
    expect(await as(agent, "select created_at is not null as ok, revoked_at from public.calendar_feeds")).toEqual([
      { ok: true, revoked_at: null },
    ]);
    await expect(as(agent, "select token_hash from public.calendar_feeds")).rejects.toThrow();
    await expect(as(chef, "select public.create_calendar_feed($1)", [hash(2)])).rejects.toThrow(
      "Not allowed to subscribe to a calendar",
    );
    await expect(as(agent, "select public.create_calendar_feed($1)", ["pas-un-condensat"])).rejects.toThrow(
      "Invalid calendar token",
    );
    // L'agenda d'un autre ne se lit pas.
    expect(await as(other, "select count(*)::int as n from public.calendar_feeds")).toEqual([{ n: 0 }]);
  });

  it("rend les seules gardes publiées encore tenues, et date la lecture", async () => {
    const f = await feed(hash(1));
    expect(f?.user_id).toBe(agent);
    expect(f?.centre).toBe("Centre agenda");
    // Ni le brouillon du 2, ni le 3 relevé par un désistement, ni le 4 d'un autre.
    expect(f?.events.map(e => [e.shift, e.revision])).toEqual([["DAY", 1]]);
    expect(
      await live.query<{ read: boolean }>("select last_read_at is not null as read from public.calendar_feeds"),
    ).toMatchObject({ rows: [{ read: true }] });
    expect(await feed(hash(9))).toBeNull();
  });

  it("révoque l’ancienne adresse quand l’agent en demande une nouvelle, et sur révocation", async () => {
    await as(agent, "select public.create_calendar_feed($1)", [hash(3)]);
    expect(await feed(hash(1))).toBeNull();
    expect(await feed(hash(3))).not.toBeNull();
    await as(agent, "select public.revoke_calendar_feed()");
    expect(await feed(hash(3))).toBeNull();
  });

  it("coupe l’accès quand l’agent est désactivé ou passe à l’encadrement", async () => {
    await as(agent, "select public.create_calendar_feed($1)", [hash(4)]);
    // Le geste d'un administrateur, pas de l'agent : la session n'est plus la sienne.
    await live.query("select set_config('request.jwt.claim.sub', '', false)");
    await live.query("update public.memberships set active=false where user_id=$1", [agent]);
    expect(await feed(hash(4))).toBeNull();
    await live.query("update public.memberships set active=true where user_id=$1", [agent]);
    expect(await feed(hash(4))).not.toBeNull();
    await live.exec(`
      set session_replication_role = replica;
      update public.memberships set role='GESTIONNAIRE' where user_id='${agent}';
      set session_replication_role = origin;`);
    expect(await feed(hash(4))).toBeNull();
  });

  it("réserve la lecture du flux au serveur", async () => {
    await expect(as(agent, "select public.calendar_feed_events($1)", [hash(4)])).rejects.toThrow();
  });
});

describe("Migration 20261021150000 — gardes d’application", () => {
  const target = MIGRATIONS.indexOf("20261021150000_agenda_abonne.sql");
  const migration = () =>
    readFileSync(new URL(`../supabase/migrations/${MIGRATIONS[target]}`, import.meta.url), "utf8");
  const upTo = async (count: number) => {
    const db = new PGlite();
    await db.exec(baseAuthSchema);
    for (const m of MIGRATIONS.slice(0, count))
      await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
    return db;
  };

  it("refuse un second passage et un passage avant sa dépendance", async () => {
    expect(target).toBeGreaterThan(0);
    const applied = await upTo(target + 1);
    await expect(applied.exec(migration())).rejects.toThrow("déjà été appliquée");
    await applied.close();
    const early = await upTo(target - 1);
    await expect(early.exec(migration())).rejects.toThrow("20261021090000_appels_remplacement.sql");
    await early.close();
  }, 90000);
});
