import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { frenchMessage } from "../src/lib/command-errors";

describe("Traduction des refus de la base", () => {
  it("traduit les messages levés par les déclencheurs et la publication", () => {
    expect(frenchMessage({ message: "Campaign is closed" })).toContain("La campagne est fermée");
    expect(frenchMessage({ message: "Complete all dates before validation" })).toContain("chaque jour du mois");
    expect(frenchMessage({ message: "Define the staffing requirement before publishing" })).toContain(
      "Définissez les besoins",
    );
    expect(frenchMessage({ message: "Every assignment needs a validated matching availability" })).toContain(
      "disponibilité validée",
    );
  });
  it("reprend les valeurs des messages paramétrés, avec le bon accord", () => {
    expect(frenchMessage({ message: "Headcount not covered: 1 of 6" })).toBe(
      "Effectif non couvert : 1 agent affecté sur 6 requis.",
    );
    expect(frenchMessage({ message: "Headcount not covered: 3 of 6" })).toBe(
      "Effectif non couvert : 3 agents affectés sur 6 requis.",
    );
    expect(frenchMessage({ message: "Qualifications not covered: Chef, SAP" })).toBe(
      "Qualifications non couvertes : Chef, SAP.",
    );
  });
  it("traduit les refus du déclencheur de rattachement", () => {
    expect(frenchMessage({ message: "Only an administrator can change a role" })).toContain("Seul un administrateur");
    expect(frenchMessage({ message: "Cannot change your own role" })).toContain("propre rôle");
    expect(frenchMessage({ message: "Cannot deactivate your own account" })).toContain("propre compte");
    expect(frenchMessage({ message: "Only an administrator can deactivate an administrator" })).toContain(
      "désactiver ou rétrograder un administrateur",
    );
    expect(frenchMessage({ message: "Cannot remove the last administrator" })).toContain("dernier administrateur");
  });
  it("retombe sur le code SQL quand le message n’est pas reconnu", () => {
    expect(frenchMessage({ message: "permission denied for table teams", code: "42501" })).toContain(
      "n’avez pas le droit",
    );
    expect(frenchMessage({ code: "PGRST301" })).toContain("session a expiré");
  });
  // Chaque `raise exception` des migrations doit avoir sa phrase : un refus
  // qui tombe sur « Réessayez dans un instant » fait recommencer l'agent
  // contre une règle qu'on lui cache. Les gardes de migration — « Apply …
  // first », « déjà appliquée » — ne s'adressent pas à lui.
  it("traduit chaque refus que les migrations peuvent lever", () => {
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const raised = new Set<string>();
    for (const file of readdirSync(dir))
      for (const match of readFileSync(new URL(file, dir), "utf8").matchAll(/raise exception '((?:[^']|'')+)'/g))
        raised.add(match[1].replace(/''/g, "'"));
    const guard = /^(Apply |Appliquez |\d{4} has already|Cette migration a déjà)/;
    const generic = frenchMessage({ message: "Simulated" });
    const untranslated = [...raised]
      .filter(text => !guard.test(text))
      // Les paramètres « % » prennent une valeur plausible.
      .map(text => text.replace(/%/g, "2"))
      .filter(text => frenchMessage({ message: text }) === generic);
    expect(untranslated).toEqual([]);
  });

  it("ne laisse jamais fuiter un message de base de données", () => {
    for (const failure of [
      null,
      undefined,
      {},
      { message: "duplicate key value violates unique constraint «teams_pkey»" },
      { message: 'relation "public.secret" does not exist', code: "42P01" },
    ]) {
      const shown = frenchMessage(failure);
      expect(shown).toBe("La modification n’a pas pu être enregistrée. Réessayez dans un instant.");
      expect(shown).not.toMatch(/[a-z]+_[a-z]+|relation|constraint/);
    }
  });
});
