import { describe, expect, it } from "vitest";
import { message, type Pending } from "../src/lib/email";

const notice = (overrides: Partial<Pending> = {}): Pending => ({
  id: "n1",
  email: "agent@example.org",
  kind: "CAMPAIGN_OPENED",
  subject: "Campagne ouverte : Disponibilités d’octobre 2026",
  body: "Renseignez vos disponibilités avant le 30/09/2026, puis validez votre réponse.",
  ...overrides,
});

describe("Message envoyé à un agent", () => {
  it("reprend le sujet de la notification et mène à l’application", () => {
    const built = message(notice(), "https://dispo-sp.example.fr/");
    expect(built.to).toBe("agent@example.org");
    expect(built.subject).toBe("Campagne ouverte : Disponibilités d’octobre 2026");
    // La barre finale ne doit pas se retrouver doublée dans le lien.
    expect(built.text).toContain("https://dispo-sp.example.fr\n");
    expect(built.html).toContain('href="https://dispo-sp.example.fr"');
    expect(built.text).toContain("Renseigner mes disponibilités");
  });

  it("adapte l’appel à l’action au motif du message", () => {
    const published = message(
      notice({ kind: "SCHEDULE_PUBLISHED", subject: "Votre planning a été publié" }),
      "https://x.fr",
    );
    expect(published.text).toContain("Consulter mon planning");
    expect(published.html).toContain("Planning publié");
  });

  it("tient sans corps, plutôt que d’écrire « null »", () => {
    const built = message(notice({ body: null }), "https://x.fr");
    expect(built.text).not.toContain("null");
    expect(built.html).not.toContain("null");
    expect(built.subject).toBeTruthy();
  });

  it("échappe ce qui vient de la base, sujet compris", () => {
    const built = message(
      notice({ subject: "Rappel <script>alert(1)</script>", body: 'Équipe "Alpha" & Bravo' }),
      "https://x.fr",
    );
    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
    expect(built.html).toContain("&amp;");
    // Le texte brut n’a rien à échapper : il n’est pas interprété.
    expect(built.text).toContain('Équipe "Alpha" & Bravo');
  });
});
