/**
 * Une requête qui vient d'un autre site.
 *
 * Les actions serveur de Next comparent déjà l'origine ; une route POST écrite
 * à la main doit le faire elle-même. Un navigateur envoie toujours `Origin` sur
 * un POST inter-sites, et `Sec-Fetch-Site` quand il le connaît.
 */
export function crossSite(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  // Derrière un hébergeur, `request.url` peut porter l'adresse interne ; l'hôte
  // demandé par le navigateur est dans les en-têtes.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
