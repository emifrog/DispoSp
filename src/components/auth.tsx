"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Building2, ChevronRight, Eye, EyeOff, Lock, LogIn, Mail, Send, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { HOME_PATH } from "@/lib/supabase/config";
import { Brand } from "./brand";
import { Button } from "./ui/button";

const signInSchema = z.object({
  email: z.string().trim().email("Saisissez une adresse électronique valide."),
  password: z.string().min(1, "Saisissez votre mot de passe."),
});
const emailOnlySchema = z.object({
  email: z.string().trim().email("Saisissez une adresse électronique valide."),
});

// Supabase répond en anglais ; voici celles sur lesquelles l'utilisateur peut agir.
const messages: Record<string, string> = {
  "Invalid login credentials": "Adresse ou mot de passe incorrect.",
  "Email not confirmed": "Votre adresse n’est pas encore confirmée. Ouvrez le message reçu à l’inscription.",
  "No SSO provider assigned to this domain":
    "Aucune authentification unique n’est configurée pour ce domaine. Utilisez votre mot de passe.",
};
const french = (message: string, fallback: string) => messages[message] ?? fallback;

// L'adresse est retenue d'un passage à l'autre, jamais le mot de passe : c'est
// tout ce que « se souvenir de moi » recouvre ici, et l'écran le dit.
const REMEMBERED = "disposp.email";
// Lu au rendu plutôt que dans un effet : synchroniser un stockage externe vers
// un état déclenche une cascade de rendus, et le compilateur React le refuse.
// Pas d'abonnement — rien ne modifie cette clé pendant la vie de l'écran. Le
// serveur ne peut pas la lire, d'où l'instantané vide : le premier rendu du
// client correspond alors au sien, et la valeur arrive juste après.
const useRememberedEmail = () =>
  useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(REMEMBERED) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );

export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "sso" | "forgotten">("password");
  return (
    <main className="sign-in" id="main">
      {/* Le panneau de marque de la maquette. Pas de photographie : je n'en ai
          pas reçu, et une image d'illustration prise ailleurs n'a rien à faire
          sur l'écran d'entrée d'un centre de secours. */}
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
        {mode === "password" && <PasswordForm router={router} onMode={setMode} />}
        {mode === "sso" && <SsoForm onBack={() => setMode("password")} />}
        {mode === "forgotten" && <ForgottenForm onBack={() => setMode("password")} />}
        <p className="sign-in-footer">
          DispoSP · Plus loin, ensemble.
          <small>Les comptes sont créés par l’administrateur de votre centre.</small>
        </p>
      </section>
    </main>
  );
}

function PasswordForm({
  router,
  onMode,
}: {
  router: ReturnType<typeof useRouter>;
  onMode: (mode: "sso" | "forgotten") => void;
}) {
  const [failure, setFailure] = useState("");
  const [visible, setVisible] = useState(false);
  const remembered = useRememberedEmail();
  // null tant que l'agent n'a pas touché la case : elle reflète alors l'état
  // réel — cochée si une adresse est déjà retenue, décochée sinon.
  const [choice, setChoice] = useState<boolean | null>(null);
  const remember = choice ?? remembered !== "";
  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    // `values` plutôt que `defaultValues` : l'adresse retenue n'arrive qu'après
    // l'hydratation. keepDirtyValues préserve ce qui aurait déjà été saisi.
    values: { email: remembered, password: "" },
    resetOptions: { keepDirtyValues: true },
  });

  async function submit(values: z.infer<typeof signInSchema>) {
    setFailure("");
    const { error } = await createClient().auth.signInWithPassword(values);
    if (error) {
      setFailure(french(error.message, "La connexion a échoué. Réessayez dans un instant."));
      return;
    }
    try {
      if (remember) localStorage.setItem(REMEMBERED, values.email);
      else localStorage.removeItem(REMEMBERED);
    } catch {
      // Sans stockage local, l'adresse ne sera pas reproposée. La connexion, elle, a eu lieu.
    }
    // Rafraîchi pour que les composants serveur relisent les cookies qui viennent d'être posés.
    router.replace(HOME_PATH);
    router.refresh();
  }

  return (
    <>
      <h1>Connexion</h1>
      <p className="muted">Accédez à vos disponibilités et au planning de votre centre.</p>
      {/* noValidate : sinon le navigateur bloque l'envoi le premier et affiche
          ses messages dans sa langue, pas dans celle de l'application. */}
      <form noValidate onSubmit={form.handleSubmit(submit)}>
        <label className="field">
          Adresse électronique
          <span className="input-affix">
            <Mail size={17} />
            <input type="email" autoComplete="email" placeholder="votre@email.fr" {...form.register("email")} />
          </span>
        </label>
        {form.formState.errors.email && <p className="field-error">{form.formState.errors.email.message}</p>}
        {/* Association explicite plutôt qu'un label enveloppant : le bouton
            d'affichage porte « Afficher le mot de passe », et à l'intérieur du
            label il entrerait dans le nom accessible du champ. Deux commandes
            répondraient alors au même nom. */}
        <div className="field">
          <label htmlFor="password">Mot de passe</label>
          <span className="input-affix">
            <Lock size={17} />
            <input
              id="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Votre mot de passe"
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
        {form.formState.errors.password && <p className="field-error">{form.formState.errors.password.message}</p>}
        <div className="sign-in-row">
          <label className="checkbox-inline">
            <input type="checkbox" checked={remember} onChange={e => setChoice(e.target.checked)} />
            Se souvenir de mon adresse
          </label>
          <button type="button" className="text-button" onClick={() => onMode("forgotten")}>
            Mot de passe oublié ?
          </button>
        </div>
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
        <Button type="submit" className="full-width" disabled={form.formState.isSubmitting}>
          <LogIn size={17} />
          {form.formState.isSubmitting ? "Connexion…" : "Se connecter"}
          <ChevronRight size={17} />
        </Button>
      </form>
      <div className="sign-in-separator">
        <span>ou</span>
      </div>
      <Button variant="secondary" className="full-width" onClick={() => onMode("sso")}>
        <Building2 size={17} />
        Connexion par votre service
        <ChevronRight size={17} />
      </Button>
      <p className="muted small">
        <ShieldCheck size={15} /> Vos données ne servent qu’à la gestion des disponibilités de votre centre.
      </p>
    </>
  );
}

/**
 * Authentification unique SAML.
 *
 * Supabase route sur le domaine de l'adresse, pas sur l'adresse elle-même :
 * l'agent saisit la sienne, on n'en garde que ce qui suit l'arobase. Le
 * fournisseur doit avoir été déclaré côté Supabase pour ce domaine ; sans cela
 * l'appel échoue, et le message le dit plutôt que de laisser une page blanche.
 */
function SsoForm({ onBack }: { onBack: () => void }) {
  const [failure, setFailure] = useState("");
  const form = useForm<z.infer<typeof emailOnlySchema>>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });

  async function submit({ email }: z.infer<typeof emailOnlySchema>) {
    setFailure("");
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) {
      setFailure("Cette adresse ne porte pas de domaine reconnaissable.");
      return;
    }
    const { data, error } = await createClient().auth.signInWithSSO({ domain });
    if (error || !data?.url) {
      setFailure(
        french(
          error?.message ?? "",
          "Aucune authentification unique n’est configurée pour ce domaine. Utilisez votre mot de passe.",
        ),
      );
      return;
    }
    // On quitte l'application pour l'annuaire du service : assign plutôt que
    // le routeur, qui ne sait naviguer qu'à l'intérieur.
    window.location.assign(data.url);
  }

  return (
    <>
      <h1>Connexion par votre service</h1>
      <p className="muted">
        Saisissez votre adresse professionnelle. Vous serez redirigé vers l’annuaire de votre service, qui vérifiera
        votre identité.
      </p>
      <form noValidate onSubmit={form.handleSubmit(submit)}>
        <label className="field">
          Adresse professionnelle
          <span className="input-affix">
            <Building2 size={17} />
            <input type="email" autoComplete="email" placeholder="prenom.nom@sdis00.fr" {...form.register("email")} />
          </span>
        </label>
        {form.formState.errors.email && <p className="field-error">{form.formState.errors.email.message}</p>}
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
        <Button type="submit" className="full-width" disabled={form.formState.isSubmitting}>
          <Building2 size={17} />
          {form.formState.isSubmitting ? "Redirection…" : "Continuer"}
          <ChevronRight size={17} />
        </Button>
      </form>
      <BackLink onBack={onBack} />
    </>
  );
}

/**
 * Demande de réinitialisation.
 *
 * La réponse est la même que l'adresse existe ou non : dire « ce compte est
 * inconnu » transformerait l'écran en annuaire des comptes du centre.
 */
function ForgottenForm({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState("");
  const form = useForm<z.infer<typeof emailOnlySchema>>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });

  async function submit({ email }: z.infer<typeof emailOnlySchema>) {
    setFailure("");
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/nouveau-mot-de-passe`,
    });
    // Une panne de réseau se dit ; un compte inconnu, non.
    if (error && error.status !== 400 && error.status !== 422) {
      setFailure("L’envoi a échoué. Réessayez dans un instant.");
      return;
    }
    setSent(true);
  }

  if (sent)
    return (
      <>
        <h1>Message envoyé</h1>
        <p className="muted">
          Si un compte existe pour cette adresse, un lien de réinitialisation vient d’y être envoyé. Il est valable une
          heure et ne sert qu’une fois.
        </p>
        <div className="info-card horizontal">
          <Send size={22} />
          <p>Pensez à regarder dans les indésirables. Le message vient de l’adresse d’envoi de votre centre.</p>
        </div>
        <BackLink onBack={onBack} />
      </>
    );

  return (
    <>
      <h1>Mot de passe oublié</h1>
      <p className="muted">
        Saisissez votre adresse électronique. Nous vous enverrons un lien pour choisir un nouveau mot de passe.
      </p>
      <form noValidate onSubmit={form.handleSubmit(submit)}>
        <label className="field">
          Adresse électronique
          <span className="input-affix">
            <Mail size={17} />
            <input type="email" autoComplete="email" placeholder="votre@email.fr" {...form.register("email")} />
          </span>
        </label>
        {form.formState.errors.email && <p className="field-error">{form.formState.errors.email.message}</p>}
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
        <Button type="submit" className="full-width" disabled={form.formState.isSubmitting}>
          <Send size={17} />
          {form.formState.isSubmitting ? "Envoi…" : "Envoyer le lien"}
        </Button>
      </form>
      <BackLink onBack={onBack} />
    </>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="text-button sign-in-back" onClick={onBack}>
      <ArrowLeft size={15} />
      Revenir à la connexion
    </button>
  );
}
