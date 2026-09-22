import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachedSession } from "../src/lib/session";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({ createActionClient: async () => ({ rpc }) }));
import { runCommand } from "../src/lib/commands.server";

const session: AttachedSession = {
  userId: "responsable",
  email: "responsable@example.org",
  displayName: "Responsable",
  membership: {
    organizationId: "centre",
    organizationName: "Centre",
    teamId: "equipe",
    teamName: "Equipe",
    role: "RESPONSABLE",
  },
};
const command = { type: "campaign" as const, name: "Octobre", month: "2096-10", closesOn: "2096-09-25" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Création de campagne depuis le serveur", () => {
  // L'envoi des notifications n'est plus déclenché par la commande : les deux
  // files se vident après chaque commande, depuis l'action serveur. Ici, un
  // seul appel, transactionnel, pour l'équipe de qui ouvre.
  it("confie la création à la base, pour l’équipe de qui ouvre", async () => {
    rpc.mockResolvedValue({ error: null });
    await runCommand(session, command);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_campaign", {
      org: "centre",
      team: "equipe",
      campaign_name: "Octobre",
      campaign_month: "2096-10-01",
      closes_on: "2096-09-25",
    });
  });

  // Un gestionnaire gère tout son centre : la campagne s'ouvre pour l'équipe
  // qu'elle concerne, pas forcément la sienne. La base vérifie que l'équipe
  // est bien du centre.
  it("ouvre pour l’équipe demandée quand le formulaire en nomme une", async () => {
    rpc.mockResolvedValue({ error: null });
    await runCommand(session, { ...command, teamId: "bravo" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_campaign", expect.objectContaining({ team: "bravo" }));
  });

  it.each([
    ["Not allowed to create this campaign", "Vous n’avez pas le droit de créer une campagne pour cette équipe."],
    ["Campaign closing date must be in the future", "La date de clôture de la campagne doit être à venir."],
    ["Campaign name is too short", "Le nom de la campagne doit contenir au moins trois caractères."],
    ["Campaign month must start on the first day", "Choisissez un mois valide pour la campagne."],
    ["Simulated internal failure", "La modification n’a pas pu être enregistrée. Réessayez dans un instant."],
  ])("traduit le refus : %s", async (message, shown) => {
    rpc.mockResolvedValue({ error: { message } });
    await expect(runCommand(session, command)).rejects.toThrow(shown);
  });
});

describe("Disponibilité habituelle depuis le serveur", () => {
  const agent: AttachedSession = { ...session, userId: "agent", membership: { ...session.membership, role: "AGENT" } };

  it("confie la semaine entière à la base, jours vides compris", async () => {
    rpc.mockResolvedValue({ error: null });
    await runCommand(agent, {
      type: "template",
      days: { 1: "UNAVAILABLE", 2: null, 6: "FULL_24H" },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_availability_template", {
      org: "centre",
      days: { 1: "UNAVAILABLE", 2: null, 6: "FULL_24H" },
    });
  });

  // Le mois n’est plus découpé par type de disponibilité : un seul appel, donc
  // un mois entièrement appliqué ou pas du tout.
  it("applique le mois en un seul appel", async () => {
    rpc.mockResolvedValue({ error: null });
    await runCommand(agent, { type: "applyTemplate", campaignId: "campagne" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("apply_availability_template", { campaign: "campagne" });
  });

  it("traduit le refus de la base, sans jamais en montrer le texte", async () => {
    rpc.mockResolvedValue({ error: { message: "Availability template is empty", code: "P0002" } });
    await expect(runCommand(agent, { type: "applyTemplate", campaignId: "campagne" })).rejects.toThrow(
      "Votre disponibilité habituelle est vide : renseignez-la d’abord.",
    );
    rpc.mockResolvedValue({ error: { message: "Campaign is closed", code: "P0001" } });
    await expect(runCommand(agent, { type: "applyTemplate", campaignId: "campagne" })).rejects.toThrow(
      "La campagne est fermée : la saisie n’est plus possible.",
    );
  });
});
