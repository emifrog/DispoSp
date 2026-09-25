"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, CircleAlert, Eye, EyeOff, Lock } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { HOME_PATH, SIGN_IN_PATH } from "@/lib/supabase/config";
import { Brand } from "./brand";
import { Button } from "./ui/button";

// Huit caractères est le minimum que Supabase impose par défaut. Le redire ici
// évite d'envoyer l'agent se faire refuser par le serveur pour l'apprendre.
const schema = z
  .object({
    password: z.string().min(8, "Au moins 8 caractères."),
    confirmation: z.string(),
  })
  .refine(v => v.password === v.confirmation, {
    path: ["confirmation"],
    message: "Les deux saisies diffèrent.",
  });

/**
 * Deux portes, une seule serrure.
 *
 * Réinitialiser un mot de passe oublié et activer un compte invité sont le même
 * geste — arriver par un lien à usage unique, puis choisir un mot de passe.
 * Seuls les mots changent, et ils comptent : on ne dit pas « nouveau mot de
 * passe » à quelqu'un qui n'en a jamais eu.
 */
const wording = {
  reset: {
    title: "Nouveau mot de passe",
    intro: "Choisissez un mot de passe que vous n’utilisez nulle part ailleurs.",
    field: "Nouveau mot de passe",
    submit: "Enregistrer et me connecter",
    expiredTitle: "Lien expiré",
    expiredBody:
      "Ce lien de réinitialisation n’est plus valable. Ils ne servent qu’une fois et expirent au bout d’une heure.",
    expiredHelp: "Demandez-en un nouveau depuis l’écran de connexion, en choisissant « Mot de passe oublié ».",
  },
  activation: {
    title: "Activer mon compte",
    intro:
      "Votre centre vous a inscrit. Choisissez le mot de passe qui vous servira à vous connecter — personne d’autre ne le connaîtra.",
    field: "Mot de passe",
    submit: "Activer mon compte",
    expiredTitle: "Lien d’activation expiré",
    expiredBody: "Ce lien ne sert qu’une fois, et il a une durée de validité limitée.",
    expiredHelp: "Demandez à votre encadrement de vous renvoyer l’invitation depuis l’écran Agents & équipes.",
  },
} as const;

export function NewPasswordForm({ variant = "reset" }: { variant?: keyof typeof wording }) {
  const words = wording[variant];
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [failure, setFailure] = useState("");
  // « checking » tant qu'on ne sait pas : le lien de récupération n'ouvre une
  // session qu'après un aller-retour, et afficher « lien invalide » pendant ce
  // temps accuserait à tort un lien parfaitement valable.
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmation: "" },
  });

  useEffect(() => {
    const supabase = createClient();
    // Deux chemins mènent ici. Par la route serveur, la session est déjà posée
    // dans les cookies. Par le lien Supabase par défaut, c'est le client qui
    // échange le code présent dans l'adresse, et l'évènement arrive ensuite.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session || event === "PASSWORD_RECOVERY") setStatus("ready");
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(current => (session ? "ready" : current === "ready" ? "ready" : "invalid"));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(values: z.infer<typeof schema>) {
    setFailure("");
    const { error } = await createClient().auth.updateUser({ password: values.password });
    if (error) {
      setFailure(
        error.message.includes("should be different")
          ? "Choisissez un mot de passe différent de l’ancien."
          : "L’enregistrement a échoué. Le lien a peut-être expiré ; demandez-en un nouveau.",
      );
      return;
    }
    router.replace(HOME_PATH);
    router.refresh();
  }

  return (
    <main className="sign-in" id="main">
      <aside className="sign-in-hero" aria-hidden="true">
        <Brand variant="onDark" width={210} />
        <h2>
          Planification
          <br />
          des disponibilités
        </h2>
        <p>Une meilleure couverture opérationnelle, ensemble.</p>
      </aside>
      <section className="sign-in-card">
        <div className="sign-in-brand">
          <Brand width={168} />
        </div>
        {status === "invalid" ? (
          <>
            <h1>{words.expiredTitle}</h1>
            <p className="muted">{words.expiredBody}</p>
            <div className="info-card horizontal">
              <CircleAlert size={22} />
              <p>{words.expiredHelp}</p>
            </div>
            <Button className="full-width" asChild>
              <Link href={SIGN_IN_PATH}>Revenir à la connexion</Link>
            </Button>
          </>
        ) : (
          <>
            <h1>{words.title}</h1>
            <p className="muted">{words.intro}</p>
            <form noValidate onSubmit={form.handleSubmit(submit)}>
              {/* Association explicite : le bouton d'affichage, s'il était
                  dans le label, entrerait dans le nom accessible du champ. */}
              <div className="field">
                <label htmlFor="new-password">{words.field}</label>
                <span className="input-affix">
                  <Lock size={17} />
                  <input
                    id="new-password"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    disabled={status !== "ready"}
                    aria-invalid={form.formState.errors.password ? true : undefined}
                    aria-describedby={form.formState.errors.password ? "new-password-error" : undefined}
                    {...form.register("password")}
                  />
                  <button
                    type="button"
                    className="input-reveal"
                    aria-pressed={visible}
                    aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    onClick={() => setVisible(v => !v)}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </div>
              {form.formState.errors.password && (
                <p id="new-password-error" className="field-error">
                  {form.formState.errors.password.message}
                </p>
              )}
              <label className="field">
                Confirmation
                <span className="input-affix">
                  <Lock size={17} />
                  <input
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    disabled={status !== "ready"}
                    aria-invalid={form.formState.errors.confirmation ? true : undefined}
                    aria-describedby={form.formState.errors.confirmation ? "confirmation-error" : undefined}
                    {...form.register("confirmation")}
                  />
                </span>
              </label>
              {form.formState.errors.confirmation && (
                <p id="confirmation-error" className="field-error">
                  {form.formState.errors.confirmation.message}
                </p>
              )}
              {failure && (
                <p className="field-error" role="alert">
                  {failure}
                </p>
              )}
              <Button
                type="submit"
                className="full-width"
                disabled={status !== "ready"}
                pending={status === "checking" || form.formState.isSubmitting}
              >
                {status !== "checking" && !form.formState.isSubmitting && <Check size={17} />}
                {status === "checking"
                  ? "Vérification du lien…"
                  : form.formState.isSubmitting
                    ? "Enregistrement…"
                    : words.submit}
              </Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
