import { readFileSync } from "node:fs";
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

  // L'image est distante : beaucoup de messageries la bloquent par défaut. Elle
  // ne doit donc rien porter d'essentiel, et son adresse doit être absolue.
  it("porte la marque sans lui confier d’information", () => {
    const built = message(notice(), "https://dispo-sp.example.fr/");
    expect(built.html).toContain('src="https://dispo-sp.example.fr/logo-disposp.png"');
    expect(built.html).toContain('alt="DispoSP"');
    expect(built.text).toContain("Renseigner mes disponibilités : https://dispo-sp.example.fr");
    expect(built.text).not.toContain("logo-disposp");
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

/**
 * Les gabarits de Supabase Auth.
 *
 * Ils ne passent par aucun code d'ici : ils sont collés dans le tableau de bord,
 * et Supabase y substitue lui-même `{{ .SiteURL }}` et `{{ .TokenHash }}`. Ce
 * que ce fichier garde, c'est leur seule partie non décorative — le lien —,
 * parce qu'une faute à cet endroit ne se voit qu'à l'arrivée, sur le téléphone
 * d'un agent qui ne peut plus entrer.
 */
describe("Gabarits d’e-mail Supabase Auth", () => {
  const gabarit = (name: string) => readFileSync(new URL(`../supabase/templates/${name}`, import.meta.url), "utf8");

  it("mène l’invitation sur la route qui vérifie le jeton côté serveur", () => {
    expect(gabarit("invitation.html")).toContain(
      "{{ .SiteURL }}/auth/activation?token_hash={{ .TokenHash }}&amp;type=invite",
    );
  });

  it("mène la réinitialisation sur la sienne", () => {
    expect(gabarit("reinitialisation.html")).toContain(
      "{{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&amp;type=recovery",
    );
  });

  it("n’écrit aucune adresse en dur", () => {
    for (const name of ["invitation.html", "reinitialisation.html"]) {
      const html = gabarit(name);
      // Une adresse figée là enverrait chaque agent ailleurs que sur le site du
      // centre — et « localhost », sur son propre téléphone.
      expect(html, name).not.toMatch(/https?:\/\/(?!\{\{)/);
      // Y compris pour le logo : il se sert depuis l'application elle-même.
      expect(html, name).toContain('src="{{ .SiteURL }}/logo-disposp.png"');
    }
  });
});
