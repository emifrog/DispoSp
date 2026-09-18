"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LogIn, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { HOME_PATH } from "@/lib/supabase/config";
import { Brand } from "./brand";
import { Button } from "./ui/button";

const signInSchema = z.object({
  email: z.string().trim().email("Saisissez une adresse électronique valide."),
  password: z.string().min(1, "Saisissez votre mot de passe."),
});

// Supabase returns its errors in English; these are the ones a user can act on.
const messages: Record<string, string> = {
  "Invalid login credentials": "Adresse ou mot de passe incorrect.",
  "Email not confirmed": "Votre adresse n’est pas encore confirmée. Ouvrez le message reçu à l’inscription.",
};

export function SignInForm() {
  const router = useRouter();
  const [failure, setFailure] = useState("");
  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  async function submit(values: z.infer<typeof signInSchema>) {
    setFailure("");
    const { error } = await createClient().auth.signInWithPassword(values);
    if (error) {
      setFailure(messages[error.message] ?? "La connexion a échoué. Réessayez dans un instant.");
      return;
    }
    // Refresh so the Server Components re-read the session cookies just written.
    router.replace(HOME_PATH);
    router.refresh();
  }

  return (
    <main className="sign-in" id="main">
      <section className="sign-in-card">
        <Brand />
        <h1>Connexion</h1>
        <p className="muted">Accédez à vos disponibilités et au planning de votre centre.</p>
        {/* noValidate: the browser's own checks would block submission first and
            show their messages in the browser's language, not the app's. */}
        <form noValidate onSubmit={form.handleSubmit(submit)}>
          <label className="field">
            Adresse électronique
            <input type="email" autoComplete="email" autoFocus {...form.register("email")} />
          </label>
          {form.formState.errors.email && <p className="field-error">{form.formState.errors.email.message}</p>}
          <label className="field">
            Mot de passe
            <input type="password" autoComplete="current-password" {...form.register("password")} />
          </label>
          {form.formState.errors.password && <p className="field-error">{form.formState.errors.password.message}</p>}
          {failure && (
            <p className="field-error" role="alert">
              {failure}
            </p>
          )}
          <Button type="submit" className="full-width" disabled={form.formState.isSubmitting}>
            <LogIn size={17} />
            {form.formState.isSubmitting ? "Connexion…" : "Se connecter"}
          </Button>
        </form>
        <p className="muted small">
          <ShieldCheck size={15} /> Les comptes sont créés par l’administrateur du centre.
        </p>
      </section>
    </main>
  );
}
