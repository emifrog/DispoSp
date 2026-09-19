"use server";
import { runCommand } from "@/lib/commands.server";
import { commandLabels, commandSchema } from "@/lib/domain";
import { readSession } from "@/lib/session.server";

export type CommandResult = { ok: true; label: string } | { ok: false; message: string };

// A Server Action is a public endpoint reachable by anyone who can POST to the
// application: the payload is parsed here, and the identity is read from the
// session cookie rather than taken from what the browser claims.
export async function submitCommand(payload: unknown): Promise<CommandResult> {
  const parsed = commandSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "La demande est incomplète ou mal formée." };
  const session = await readSession();
  if (!session) return { ok: false, message: "Votre session a expiré. Reconnectez-vous." };
  if (!session.membership) return { ok: false, message: "Votre compte n’est rattaché à aucun centre." };
  try {
    await runCommand({ ...session, membership: session.membership }, parsed.data);
    return { ok: true, label: commandLabels[parsed.data.type] };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "L’action n’a pas pu être enregistrée.",
    };
  }
}
