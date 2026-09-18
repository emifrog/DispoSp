/* DISPO SP — agent de service minimal.
 *
 * Sa seule raison d'être est l'installation : un navigateur ne propose l'ajout à
 * l'écran d'accueil qu'à une application dotée d'un gestionnaire « fetch ».
 *
 * Il ne met en cache AUCUNE donnée. Une disponibilité, une affectation ou un
 * planning servis depuis un cache seraient une information périmée présentée
 * comme à jour : dans ce métier, c'est pire que pas d'information du tout. Un
 * agent qui se croit affecté, un chef qui compte sur un effectif d'hier — le
 * réseau reste donc seul maître de chaque réponse.
 *
 * Une seule exception, et elle ne contient rien : la page qui annonce la perte
 * de connexion. Par construction, elle ne peut pas être périmée.
 */
const SHELL = "disposp-hors-ligne-v1";
const OFFLINE = "/hors-ligne";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.add(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== SHELL).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  // Tout le reste — données, actions, ressources — passe au réseau sans
  // interception. Ce gestionnaire n'existe que pour les navigations.
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
