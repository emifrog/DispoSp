import { authorizedPushWorker } from "@/lib/push-auth";
import { dispatchPush } from "@/lib/push.server";
export async function POST(request: Request) {
  if (!authorizedPushWorker(request.headers.get("authorization"), process.env.PUSH_DISPATCH_SECRET))
    return new Response("Non autorisé", { status: 401 });
  try {
    return Response.json(await dispatchPush(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Le traitement Web Push a échoué.");
    return new Response("Traitement indisponible", { status: 503 });
  }
}
