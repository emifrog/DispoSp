// Partagés par le proxy (serveur) et le fournisseur d'état (navigateur) : ce
// module n'importe rien, pour que chacun puisse le charger.

/** Le paramètre d'adresse qui porte la campagne choisie : `?campagne=…`. */
export const CAMPAIGN_PARAM = "campagne";
/** L'en-tête par lequel le proxy le transmet à la mise en page. */
export const CAMPAIGN_HEADER = "x-disposp-campagne";
