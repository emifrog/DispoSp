import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/lib/session";

// L'action serveur : ce qu'elle vérifie avant d'écrire, et ce qu'elle
// déclenche après. Les deux files — poussée et email — se vident après chaque
// commande réussie, quel qu'en soit l'auteur : c'est ce qui permet à un
// désistement d'être signalé sans attendre le geste d'un gestionnaire.
const { after, readSession, runCommand, dispatchPush, dispatchEmails } = vi.hoisted(() => ({
  after: vi.fn((work: () => Promise<void>) => work()),
  readSession: vi.fn(),
  runCommand: vi.fn(),
  dispatchPush: vi.fn(),
  dispatchEmails: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after }));
vi.mock("../src/lib/session.server", () => ({ readSession }));
vi.mock("../src/lib/commands.server", () => ({ runCommand }));
vi.mock("../src/lib/push.server", () => ({ dispatchPush, pushConfigured: () => true }));
vi.mock("../src/lib/mailer.server", () => ({ dispatchEmails, emailConfigured: () => true }));
import { submitCommand } from "../src/app/actions";

const attached: Session = {
  userId: "agent",
  email: "agent@example.org",
  displayName: "Agent",
  membership: {
    organizationId: "centre",
    organizationName: "Centre",
    teamId: "equipe",
    teamName: "Équipe",
    role: "AGENT",
  },
};
// Un identifiant au format de la base : le schéma refuse désormais tout le reste.
const command = { type: "readNotifications" as const, ids: ["60000000-0000-0000-0000-000000000001"] };

beforeEach(() => {
  vi.resetAllMocks();
  after.mockImplementation((work: () => Promise<void>) => work());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Action serveur", () => {
  it("vide les deux files après une commande réussie, une fois la réponse partie", async () => {
    readSession.mockResolvedValue(attached);
    runCommand.mockResolvedValue(undefined);
    dispatchPush.mockResolvedValue({ processed: 0, sent: 0 });
    dispatchEmails.mockResolvedValue({ processed: 0, sent: 0 });
    await expect(submitCommand(command)).resolves.toEqual({ ok: true, label: expect.any(String) });
    expect(after).toHaveBeenCalledOnce();
    expect(dispatchPush).toHaveBeenCalledOnce();
    expect(dispatchEmails).toHaveBeenCalledOnce();
  });

  it("rend le libellé de la commande quand elle en donne un, le libellé fixe sinon", async () => {
    readSession.mockResolvedValue(attached);
    runCommand.mockResolvedValue("Relance envoyée à 3 agents");
    await expect(submitCommand(command)).resolves.toEqual({ ok: true, label: "Relance envoyée à 3 agents" });
    runCommand.mockResolvedValue(undefined);
    const fixed = await submitCommand(command);
    expect(fixed).toMatchObject({ ok: true });
    expect(fixed.ok && fixed.label).not.toBe("Relance envoyée à 3 agents");
  });

  it("vide la file email même quand la file poussée échoue, sans faire échouer la commande", async () => {
    readSession.mockResolvedValue(attached);
    runCommand.mockResolvedValue(undefined);
    dispatchPush.mockRejectedValue(new Error("service de remise indisponible"));
    dispatchEmails.mockResolvedValue({ processed: 1, sent: 1 });
    await expect(submitCommand(command)).resolves.toMatchObject({ ok: true });
    expect(dispatchEmails).toHaveBeenCalledOnce();
    // Avec sa cause : « a échoué » seul ne disait pas où chercher.
    expect(console.error).toHaveBeenCalledWith("Le traitement Web Push a échoué :", "service de remise indisponible");
  });

  it("journalise la cause d’un échec de la file email", async () => {
    readSession.mockResolvedValue(attached);
    runCommand.mockResolvedValue(undefined);
    dispatchPush.mockResolvedValue({ processed: 0, sent: 0 });
    dispatchEmails.mockRejectedValue(new Error("Réservation des envois impossible : permission denied"));
    await expect(submitCommand(command)).resolves.toMatchObject({ ok: true });
    expect(console.error).toHaveBeenCalledWith(
      "Le traitement des emails a échoué :",
      "Réservation des envois impossible : permission denied",
    );
  });

  // Une panne d'Auth n'est pas une session expirée : l'agent ne doit pas être
  // envoyé se reconnecter pour rien.
  it("ne parle pas de session expirée quand la session n’a pas pu être vérifiée", async () => {
    readSession.mockRejectedValue(new Error("La connexion n’a pas pu être vérifiée. Réessayez dans un instant."));
    await expect(submitCommand(command)).resolves.toEqual({
      ok: false,
      message: "La connexion n’a pas pu être vérifiée. Réessayez dans un instant.",
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("refuse un identifiant qui n’a pas la forme de ceux de la base", async () => {
    await expect(submitCommand({ type: "readNotifications", ids: ["n1"] })).resolves.toEqual({
      ok: false,
      message: "La demande est incomplète ou mal formée.",
    });
  });

  it("ne vide rien après un refus, et rend le message tel quel", async () => {
    readSession.mockResolvedValue(attached);
    runCommand.mockRejectedValue(new Error("La campagne est fermée : la saisie n’est plus possible."));
    await expect(submitCommand(command)).resolves.toEqual({
      ok: false,
      message: "La campagne est fermée : la saisie n’est plus possible.",
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("refuse une demande mal formée avant même de lire la session", async () => {
    await expect(submitCommand({ type: "inconnu" })).resolves.toEqual({
      ok: false,
      message: "La demande est incomplète ou mal formée.",
    });
    expect(readSession).not.toHaveBeenCalled();
  });

  it("refuse sans session, et sans rattachement", async () => {
    readSession.mockResolvedValueOnce(null);
    await expect(submitCommand(command)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("expiré"),
    });
    readSession.mockResolvedValueOnce({ ...attached, membership: null });
    await expect(submitCommand(command)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("aucun centre"),
    });
    expect(runCommand).not.toHaveBeenCalled();
  });
});
