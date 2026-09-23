import { NextRequest } from "next/server";
import { CAMPAIGN_HEADER, CAMPAIGN_PARAM } from "./campaign-param";

/**
 * Une mise en page ne reçoit pas les paramètres de l'adresse, et c'est elle qui
 * charge l'état : sans ce relais, une campagne archivée choisie au sélecteur
 * n'aurait jamais son détail. Le proxy recopie donc le paramètre dans un
 * en-tête de la requête.
 *
 * L'en-tête reçu du navigateur est toujours écarté : seul le proxy l'écrit.
 * Le forger n'apprendrait rien de plus — la base filtre — mais il n'a pas à
 * venir d'ailleurs.
 */
export function forwardCampaign(request: NextRequest): NextRequest {
  const headers = new Headers(request.headers);
  headers.delete(CAMPAIGN_HEADER);
  const asked = request.nextUrl.searchParams.get(CAMPAIGN_PARAM);
  if (asked && /^[0-9a-f-]{36}$/i.test(asked)) headers.set(CAMPAIGN_HEADER, asked);
  return new NextRequest(request, { headers });
}
