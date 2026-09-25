import { authorizedPushWorker } from "@/lib/push-auth";
import { dispatchPush } from "@/lib/push.server";
export async function POST(request: Request) {
  if (!authorizedPushWorker(request.headers.get("authorization"), process.env.PUSH_DISPATCH_SECRET))
    return new Response("Non autorisé", { status: 401 });
  try {
    return Response.json(await dispatchPush(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // La cause, sans quoi la ligne ne dit pas où chercher ; le message seul,
    // jamais l'objet, qui peut porter la requête et sa clé.
    console.error("Le traitement Web Push a échoué :", error instanceof Error ? error.message : String(error));
    return new Response("Traitement indisponible", { status: 503 });
  }
}
