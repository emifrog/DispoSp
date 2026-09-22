import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, provisioningScript } from "./fixtures/schema";

/**
 * Les scripts de `supabase/provisioning/`.
 *
 * Ils s'exécutent à la main, dans l'éditeur SQL du tableau de bord, sur la vraie
 * base d'un vrai centre — et certains effacent. Ce fichier exécute **les
 * fichiers eux-mêmes**, pas une copie de leurs instructions : c'est le seul
 * moyen que l'ordre d'effacement soit vérifié ailleurs que chez le porteur du
 * projet. Toutes les clés étrangères de ce schéma sont en « on delete
 * restrict » : une table oubliée, et la transaction échoue.
 */
describe("Bascule du centre d’essai vers un vrai centre", () => {
  const org = "10000000-0000-0000-0000-0000000000c0";
  const team = "20000000-0000-0000-0000-0000000000c0";
  const chef = "30000000-0000-0000-0000-0000000000c0";
  const agent = "30000000-0000-0000-0000-0000000000c1";
  const parti = "30000000-0000-0000-0000-0000000000c2";
  const campaign = "40000000-0000-0000-0000-0000000000c0";
  const qualification = "50000000-0000-0000-0000-0000000000c0";
  const schedule = "60000000-0000-0000-0000-0000000000c0";
  const shift = "70000000-0000-0000-0000-0000000000c0";
  const requirement = "80000000-0000-0000-0000-0000000000c0";
  const p256dh = "B".repeat(87);
  const auth = "A".repeat(22);
  let live: PGlite;

  /** Le script tel qu'il est livré, avec les seules valeurs qu'on demande d'adapter. */
  const bascule = (admin = "chef@essai.test", suivent = "array['agent@essai.test']") =>
    provisioningScript("basculer-vers-un-vrai-centre.sql")
      .replace("'administrateur@exemple.fr'", `'${admin}'`)
      .replace("array['agent.de.recette@exemple.fr']", suivent);
  const count = async (table: string, where = "") =>
    Number((await live.query<{ n: number }>(`select count(*) as n from public.${table} ${where}`)).rows[0].n);

  beforeAll(async () => {
    live = await freshDatabase();
    // Un centre d'essai comme celui d'un vrai projet : des comptes, une campagne
    // close et verrouillée, un planning publié, un désistement, un appareil
    // abonné, des invitations et un journal d'audit — tout ce qui refuse de
    // disparaître quand on efface dans le désordre.
    await live.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${chef}','chef@essai.test',now()),
        ('30000000-0000-0000-0000-0000000000c3','seul@essai.test',now()),
        ('${agent}','agent@essai.test',now()),
        ('${parti}','parti@essai.test',now());
      insert into public.profiles(user_id,display_name) values
        ('${chef}','Chef'), ('${agent}','Agent'), ('${parti}','Parti'),
        ('30000000-0000-0000-0000-0000000000c3','Seul');
      insert into public.organizations(id,name,day_start,night_start) values ('${org}','CIS Test',7,19);
      insert into public.teams(id,organization_id,name) values ('${team}','${org}','Section Nord');
      insert into public.memberships values
        ('${org}','${chef}','${team}','ADMIN',true),
        ('${org}','${agent}','${team}','AGENT',true),
        ('${org}','${parti}','${team}','AGENT',true);
      -- Les horaires ont été réglés depuis l'application (organisations 7 h / 19 h) ;
      -- shift_types, que seuls les scripts écrivent, est resté à 8 h / 20 h.
      insert into public.shift_types(organization_id,code,starts_at_hour,duration_hours) values
        ('${org}','DAY',8,12), ('${org}','NIGHT',20,12);
      insert into public.qualifications(id,organization_id,name) values ('${qualification}','${org}','Chef d''agrès');
      insert into public.user_qualifications(organization_id,user_id,qualification_id)
        values ('${org}','${agent}','${qualification}');
      insert into public.availability_campaigns(id,organization_id,team_id,name,starts_on,ends_on,opens_at,closes_at)
        values ('${campaign}','${org}','${team}','Essai','2026-10-01','2026-10-02',now()-interval '1 day',now()+interval '1 day');
      insert into public.campaign_participants(organization_id,campaign_id,user_id) values
        ('${org}','${campaign}','${agent}'), ('${org}','${campaign}','${parti}');
      insert into public.availability_entries(campaign_id,user_id,date,availability_type) values
        ('${campaign}','${agent}','2026-10-01','FULL_24H'), ('${campaign}','${agent}','2026-10-02','DAY');
      insert into public.availability_templates(organization_id,user_id,weekday,availability_type)
        values ('${org}','${agent}',1,'DAY');
      insert into public.staffing_requirements(id,organization_id,campaign_id,date,shift_code,headcount)
        values ('${requirement}','${org}','${campaign}','2026-10-01','DAY',1);
      insert into public.staffing_requirement_qualifications(organization_id,requirement_id,qualification_id,minimum)
        values ('${org}','${requirement}','${qualification}',1);
      insert into public.schedules(id,organization_id,campaign_id,team_id) values ('${schedule}','${org}','${campaign}','${team}');
      insert into public.schedule_shifts(id,organization_id,schedule_id,date,shift_code)
        values ('${shift}','${org}','${schedule}','2026-10-01','DAY');
      insert into public.schedule_assignments(organization_id,schedule_shift_id,user_id,revision,status,assigned_by) values
        ('${org}','${shift}','${agent}',0,'PROPOSED','${chef}'),
        ('${org}','${shift}','${agent}',1,'CONFIRMED','${chef}');
      update public.schedule_shifts set published_revision=1, published_at=now() where id='${shift}';
      insert into public.shift_withdrawals(organization_id,schedule_shift_id,user_id,reason)
        values ('${org}','${shift}','${agent}','Essai');
      insert into public.invitations(organization_id,team_id,email,display_name,role,invited_by)
        values ('${org}','${team}','invite@essai.test','Invité','AGENT','${chef}');
      insert into public.push_subscriptions(organization_id,user_id,endpoint,p256dh,auth)
        values ('${org}','${agent}','https://fcm.googleapis.com/fcm/send/essai','${p256dh}','${auth}');
      insert into public.notifications(organization_id,user_id,kind,subject)
        values ('${org}','${agent}','SCHEDULE_PUBLISHED','Votre planning a été publié');
      update public.availability_campaigns set locked=true, closes_at=now()-interval '1 hour' where id='${campaign}';`);
  }, 30000);
  afterAll(async () => {
    await live.close();
  });

  it("refuse tout, et n’écrit rien, si le compte administrateur n’existe pas", async () => {
    await expect(live.exec(bascule("inconnu@essai.test"))).rejects.toThrow("Aucun compte");
    expect(await count("organizations")).toBe(1);
    expect(await count("availability_entries")).toBe(2);
  });

  it("refuse aussi un compte repris qui n’existe pas, avant d’effacer quoi que ce soit", async () => {
    await expect(live.exec(bascule("chef@essai.test", "array['fantome@essai.test']"))).rejects.toThrow(
      "fantome@essai.test n'existe pas",
    );
    expect(await count("organizations")).toBe(1);
    expect(await count("schedule_assignments")).toBe(2);
  });

  it("refuse un compte nommé deux fois, avant d’effacer quoi que ce soit", async () => {
    // Le cas courant : l'administrateur est aussi le compte de recette. Sans ce
    // refus, la bascule irait jusqu'au bout puis échouerait sur la clé primaire
    // de memberships, avec un message qui ne dit rien de la cause.
    await expect(live.exec(bascule("chef@essai.test", "array['chef@essai.test']"))).rejects.toThrow(
      "administre déjà le centre",
    );
    await expect(live.exec(bascule("chef@essai.test", "array['agent@essai.test','agent@essai.test']"))).rejects.toThrow(
      "deux fois le même compte",
    );
    expect(await count("organizations")).toBe(1);
  });

  it("refuse un compte encore actif dans un centre qu’on n’efface pas", async () => {
    // Un compte n'est actif que dans un seul centre : le chef de l'essai ne peut
    // pas administrer le nouveau centre tant que l'essai reste debout.
    const garde = provisioningScript("basculer-vers-un-vrai-centre.sql")
      .replace("'administrateur@exemple.fr'", "'chef@essai.test'")
      .replace("array['agent.de.recette@exemple.fr']", "array[]::text[]")
      .replace(":= 'CIS Test';", ":= null;");
    await expect(live.exec(garde)).rejects.toThrow("encore actif dans un autre centre");
    expect(await count("organizations")).toBe(1);
  });

  it("accepte une liste vide : l’administrateur seul", async () => {
    // Le rattachement des autres se fait ensuite par invitation, depuis
    // l'application. Passer par le script n'est utile que pour les comptes qui
    // existent déjà, celui de la recette en tête.
    const seul = provisioningScript("basculer-vers-un-vrai-centre.sql")
      .replace("'administrateur@exemple.fr'", "'seul@essai.test'")
      .replace("array['agent.de.recette@exemple.fr']", "array[]::text[]")
      .replace("'CIS Nice Bon Voyage'", "'CIS Essai à blanc'")
      // `essai_nom` à NULL : ce parcours ne vérifie que la création, et le
      // centre d'essai sert encore aux suivants.
      .replace(":= 'CIS Test';", ":= null;");
    await live.exec(seul);
    expect(
      await count(
        "memberships",
        "where organization_id = (select id from public.organizations where name='CIS Essai à blanc')",
      ),
    ).toBe(1);
    // Ce centre-là n'existe que pour ce parcours : on le retire pour que les
    // suivants retrouvent la base telle qu'ils l'attendent. Le journal d'audit
    // en dernier, et pour la raison même que le script encode : effacer les
    // qualifications y écrit encore, et la ligne restante empêcherait ensuite
    // de supprimer l'organisation.
    await live.exec(`
      create temporary table blanc as select id from public.organizations where name='CIS Essai à blanc';
      delete from public.memberships where organization_id in (select id from blanc);
      delete from public.qualifications where organization_id in (select id from blanc);
      delete from public.shift_types where organization_id in (select id from blanc);
      delete from public.teams where organization_id in (select id from blanc);
      delete from public.audit_logs where organization_id in (select id from blanc);
      delete from public.organizations where id in (select id from blanc);
      drop table blanc;`);
  });

  it("crée le vrai centre et y rattache les comptes nommés", async () => {
    await live.exec(bascule());
    const centre = (
      await live.query<{ day_start: number; night_start: number }>(
        "select day_start, night_start from public.organizations where name='CIS Nice Bon Voyage'",
      )
    ).rows;
    expect(centre).toHaveLength(1);
    // Les horaires du centre d'essai avaient été réglés pour de bon, depuis
    // l'application : les recréer à 8 h et 20 h — ce que shift_types disait
    // encore — serait une régression que personne ne remarquerait avant la
    // première campagne.
    expect(centre[0]).toMatchObject({ day_start: 7, night_start: 19 });
    expect((await live.query("select name from public.teams")).rows).toEqual([{ name: "Bon Voyage" }]);
    expect(
      (
        await live.query<{ email: string; role: string }>(
          "select u.email, m.role from public.memberships m join auth.users u on u.id=m.user_id order by m.role",
        )
      ).rows,
    ).toEqual([
      { email: "chef@essai.test", role: "ADMIN" },
      { email: "agent@essai.test", role: "AGENT" },
    ]);
    expect(await count("shift_types")).toBe(2);
    expect(await count("qualifications")).toBe(4);
  });

  it("ne laisse aucune ligne du centre d’essai derrière lui", async () => {
    // La campagne était close et verrouillée : sans la mise en sommeil du garde
    // de 0001, l'effacement des disponibilités aurait levé « Campaign is closed »
    // et toute la bascule aurait échoué.
    for (const table of [
      "availability_entries",
      "availability_templates",
      "campaign_participants",
      "availability_campaigns",
      "staffing_requirements",
      "staffing_requirement_qualifications",
      "schedules",
      "schedule_shifts",
      "schedule_assignments",
      "shift_withdrawals",
      "user_qualifications",
      "invitations",
      "notifications",
      "push_subscriptions",
      "push_deliveries",
    ])
      expect(await count(table), table).toBe(0);
    expect(await count("organizations", "where name='CIS Test'")).toBe(0);
    expect(await count("audit_logs", `where organization_id='${org}'`)).toBe(0);
  });

  it("garde au journal la trace de la création du nouveau centre", async () => {
    // Le journal du centre d'essai est parti avec lui, mais la création de
    // celui-ci est une action comme une autre : elle s'écrit. Une base dont
    // l'audit serait vide après une telle opération ne le dirait pas.
    const written = (
      await live.query<{ entity: string }>("select distinct entity from public.audit_logs order by entity")
    ).rows.map(row => row.entity);
    expect(written.length).toBeGreaterThan(0);
    expect(await count("audit_logs", `where organization_id <> '${org}'`)).toBe(await count("audit_logs"));
  });

  it("rend le garde des disponibilités après son passage", async () => {
    // Le laisser désactivé rouvrirait l'écriture des disponibilités sur une
    // campagne close, pour tout le monde et sans que rien ne le signale.
    expect(
      (await live.query<{ tgenabled: string }>("select tgenabled from pg_trigger where tgname = 'availability_write'"))
        .rows,
    ).toEqual([{ tgenabled: "O" }]);
  });

  it("laisse les comptes d’authentification et leurs fiches", async () => {
    // Effacer une identité est un geste qui se fait à la main, en le regardant :
    // le compte non repris reste, simplement rattaché à rien — l'application lui
    // dira qu'il n'appartient à aucun centre.
    expect(await count("profiles")).toBe(4);
    expect(Number((await live.query<{ n: number }>("select count(*) as n from auth.users")).rows[0].n)).toBe(4);
    expect(await count("memberships", `where user_id='${parti}'`)).toBe(0);
  });

  it("refuse de s’exécuter deux fois", async () => {
    await expect(live.exec(bascule())).rejects.toThrow("existe déjà");
  });
});
