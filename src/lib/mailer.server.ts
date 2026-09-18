import "server-only";
import { message, type Pending } from "./email";
import type { createActionClient } from "./supabase/server";

type Client = Awaited<ReturnType<typeof createActionClient>>;

const RESEND_BATCH = "https://api.resend.com/emails/batch";

/**
 * Sends what the database says is pending, then marks it sent.
 *
 * Never throws. A notification is earned the moment it is written; sending is a
 * separate act that may fail, and a failed send must not undo the write that
 * caused it. Rows left unsent stay in the queue for the next pass.
 */
export async function dispatch(client: Client, organizationId: string): Promise<number> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const appUrl = process.env.APP_URL;
  // No service configured: the notices still reach the in-app centre, which is
  // the whole point of keeping the queue in the database rather than in a call.
  if (!key || !from || !appUrl) return 0;

  const { data, error } = await client.rpc("pending_notifications", { org: organizationId, batch: 50 });
  if (error || !Array.isArray(data) || !data.length) return 0;
  const pending = data as Pending[];

  try {
    const response = await fetch(RESEND_BATCH, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        pending.map(notice => {
          const built = message(notice, appUrl);
          return { from, to: [built.to], subject: built.subject, text: built.text, html: built.html };
        }),
      ),
    });
    // All or nothing: the batch either left or it did not, and marking a message
    // sent that never left would silence it for good.
    if (!response.ok) {
      console.error("Resend a refusé le lot", response.status, await response.text().catch(() => ""));
      return 0;
    }
  } catch (failure) {
    console.error("Envoi impossible", failure);
    return 0;
  }

  const { error: markFailure } = await client.rpc("mark_notifications_sent", { ids: pending.map(n => n.id) });
  // Sent but not marked: the next pass would send them again. Worth a line in
  // the log, not worth failing the command that triggered it.
  if (markFailure) console.error("Envoi effectué mais non enregistré", markFailure.message);
  return pending.length;
}
