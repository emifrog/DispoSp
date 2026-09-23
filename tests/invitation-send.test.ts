import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachedSession } from "../src/lib/session";

// B1 de l'analyse du 23 septembre : un envoi d'invitation qui ne part pas est
// rendu, et le gestionnaire lit pourquoi.
const { rpc, single, inviteUserByEmail, adminRpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
  single: vi.fn(),
  inviteUserByEmail: vi.fn(),
  adminRpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({
  createActionClient: async () => ({
    rpc,
    from: () => ({ insert: () => ({ select: () => ({ single }) }) }),
  }),
}));
vi.mock("../src/lib/supabase/admin.server", () => ({
  canInvite: () => true,
  createAdminClient: () => ({ auth: { admin: { inviteUserByEmail } }, rpc: adminRpc }),
}));
import { runCommand } from "../src/lib/commands.server";

const session: AttachedSession = {
  userId: "gestionnaire",
  email: "chef@example.org",
  displayName: "Chef",
  membership: {
    organizationId: "centre",
    organizationName: "Centre",
    teamId: "equipe",
    teamName: "Équipe",
    role: "GESTIONNAIRE",
  },
};
const invitation = "50000000-0000-0000-0000-000000000001";
const resend = { type: "resendInvitation" as const, invitationId: invitation };
const invite = {
  type: "invite" as const,
  email: "recrue@example.org",
  name: "Recrue",
  grade: "",
  fonction: "",
  matricule: "",
  phone: "",
  role: "AGENT" as const,
};
const rateLimited = { message: "email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" };

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockResolvedValue({ data: "recrue@example.org", error: null });
  single.mockResolvedValue({ data: { id: invitation }, error: null });
  adminRpc.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Envoi d’une invitation", () => {
  it("ne rend rien quand le message part", async () => {
    inviteUserByEmail.mockResolvedValue({ error: null });
    await runCommand(session, resend);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reserve_invitation_send", { invitation });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("rend la réservation quand Supabase limite les envois, et le dit", async () => {
    inviteUserByEmail.mockResolvedValue({ error: rateLimited });
    await expect(runCommand(session, resend)).rejects.toThrow(
      "Supabase limite le nombre d’emails envoyés par heure : ce message n’est pas parti. Réessayez plus tard.",
    );
    expect(adminRpc).toHaveBeenCalledExactlyOnceWith("release_invitation_send", { invitation });
  });

  it("rend la réservation sur toute autre panne d’envoi", async () => {
    inviteUserByEmail.mockResolvedValue({ error: { message: "SMTP unreachable", status: 500 } });
    await expect(runCommand(session, resend)).rejects.toThrow("Le message n’a pas pu partir.");
    expect(adminRpc).toHaveBeenCalledExactlyOnceWith("release_invitation_send", { invitation });
  });

  it("rend la réservation d’un compte déjà enregistré, sans en faire une erreur", async () => {
    inviteUserByEmail.mockResolvedValue({
      error: {
        message: "A user with this email address has already been registered",
        status: 422,
        code: "email_exists",
      },
    });
    await runCommand(session, invite);
    expect(adminRpc).toHaveBeenCalledExactlyOnceWith("release_invitation_send", { invitation });
  });

  it("dit que l’invitation est enregistrée quand l’envoi est limité", async () => {
    inviteUserByEmail.mockResolvedValue({ error: rateLimited });
    await expect(runCommand(session, invite)).rejects.toThrow(
      "L’invitation est enregistrée. Supabase limite le nombre d’emails envoyés par heure : ce message n’est pas parti. Renvoyez-la plus tard depuis la liste des invitations.",
    );
  });

  // Refusée par la base après l'insertion : l'invitation existe, et le
  // gestionnaire ne doit pas la recréer pour buter sur un doublon.
  it("dit que l’invitation est enregistrée quand la base refuse l’envoi", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Too many invitations sent" } });
    await expect(runCommand(session, invite)).rejects.toThrow(
      "L’invitation est enregistrée, mais son message n’est pas parti. Cinquante invitations sont déjà parties dans l’heure pour ce centre.",
    );
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
