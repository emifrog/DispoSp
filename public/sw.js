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

/* --- Notifications poussées -------------------------------------------------
 *
 * Ce qui s'affiche sur un écran verrouillé est lu par quiconque passe devant :
 * le serveur n'envoie donc ni nom, ni motif de désistement, ni détail de garde
 * — seulement la nature de l'événement et où aller le lire. Voir
 * `pushPayload()` dans src/lib/push.ts.
 */
const FALLBACK = {
  title: "DispoSP",
  body: "Une nouvelle notification vous attend.",
  url: "/notifications",
};

self.addEventListener("push", event => {
  // Une notification doit être affichée quoi qu'il arrive : un navigateur qui
  // reçoit un message poussé sans rien montrer finit par retirer
  // l'autorisation à l'application. Un contenu illisible vaut donc le texte
  // générique, pas un abandon silencieux.
  let notice = FALLBACK;
  try {
    if (event.data) notice = { ...FALLBACK, ...event.data.json() };
  } catch {
    notice = FALLBACK;
  }
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      icon: "/icon-192.png",
      badge: "/symbole-disposp.png",
      lang: "fr",
      // La notification porte l'identifiant de son message : deux passages du
      // même envoi remplacent la même bulle au lieu d'en empiler deux.
      tag: notice.tag,
      data: { url: notice.url || FALLBACK.url },
    }),
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || FALLBACK.url, self.location.origin);
  event.waitUntil(
    (async () => {
      // Une fenêtre de l'application est déjà ouverte : elle est amenée au
      // premier plan et navigue. En ouvrir une seconde laisserait l'agent avec
      // deux DispoSP dont l'un montre l'écran d'avant.
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).origin !== target.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(target.href).catch(() => {});
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

/* Un service de remise peut renouveler un abonnement de lui-même. Sans ce
 * gestionnaire, l'appareil garderait une case cochée dans l'application et ne
 * recevrait plus rien : le silence serait pris pour « aucune notification ». */
self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription?.options?.applicationServerKey;
      if (!key) return;
      const renewed = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(renewed),
      });
    })().catch(() => {}),
  );
});
