import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachedSession } from "../src/lib/session";

const { rpc, dispatch } = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({ createActionClient: async () => ({ rpc }) }));
vi.mock("../src/lib/mailer.server", () => ({ dispatch }));
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
  it("attend la transaction avant de déclencher l’envoi des notifications", async () => {
    let finish!: (value: { error: null }) => void;
    rpc.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const result = runCommand(session, command);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledWith("create_campaign", {
      org: "centre",
      team: "equipe",
      campaign_name: "Octobre",
      campaign_month: "2096-10-01",
      closes_on: "2096-09-25",
    });
    expect(dispatch).not.toHaveBeenCalled();
    finish({ error: null });
    await result;
    expect(dispatch).toHaveBeenCalledWith({ rpc }, "centre");
  });

  it.each([
    ["Not allowed to create this campaign", "Vous n’avez pas le droit de créer une campagne pour cette équipe."],
    ["Campaign closing date must be in the future", "La date de clôture de la campagne doit être à venir."],
    ["Campaign name is too short", "Le nom de la campagne doit contenir au moins trois caractères."],
    ["Campaign month must start on the first day", "Choisissez un mois valide pour la campagne."],
    ["Simulated internal failure", "La modification n’a pas pu être enregistrée. Réessayez dans un instant."],
  ])("traduit le refus et n’envoie aucun email après un échec : %s", async (message, shown) => {
    rpc.mockResolvedValue({ error: { message } });
    await expect(runCommand(session, command)).rejects.toThrow(shown);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
