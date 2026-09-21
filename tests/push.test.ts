import { describe, expect, it } from "vitest";
import { authorizedPushWorker } from "../src/lib/push-auth";
import { applicationServerKey, pushPayload, pushSubscriptionSchema, validPushEndpoint } from "../src/lib/push";

const p256dh = "B".repeat(87);
const auth = "A".repeat(22);

describe("Adresse de remise", () => {
  it("accepte celles des services connus", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://par02p-notify.notify.windows.com/w/?token=abc",
    ])
      expect(validPushEndpoint(endpoint)).toBe(true);
  });

  it("refuse tout le reste", () => {
    // Le point n'est pas le domaine : c'est qu'une adresse libre ferait de
    // l'expéditeur un relais HTTP vers l'hôte que l'appelant choisit.
    for (const endpoint of [
      "https://exemple.test/collecte",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://agent:secret@fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.exemple.test/fcm/send/abc",
      "pas une adresse",
    ])
      expect(validPushEndpoint(endpoint)).toBe(false);
  });

  it("exige les deux clés au format que rend le navigateur", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh, auth } }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh: "trop-court", auth } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh, auth: auth + "x" } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint }).success).toBe(false);
  });
});

describe("Contenu poussé", () => {
  it("ne dit que la nature de l’événement", () => {
    // Ce texte s'affiche sur un écran verrouillé, que lit quiconque passe
    // devant : ni nom, ni motif de désistement, ni date de garde.
    const payload = pushPayload("11111111-1111-1111-1111-111111111111", "WITHDRAWAL_REQUESTED");
    expect(payload.title).toBe("DispoSP");
    expect(payload.body).toBe("Une demande de désistement attend votre réponse.");
    expect(payload.url).toBe("/notifications");
    expect(payload.tag).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("reste lisible devant un type qu’il ne connaît pas", () => {
    // Une notification d'un type ajouté plus tard doit arriver quand même : un
    // message générique vaut mieux qu'une bulle vide ou pas de bulle du tout.
    expect(pushPayload("x", "TYPE_A_VENIR").body).toBe("Une nouvelle notification vous attend.");
  });
});

describe("Clé publique VAPID", () => {
  it("rend les octets que réclame le navigateur", () => {
    // base64url, sans remplissage : « - » et « _ » remplacent « + » et « / »,
    // et il faut rétablir les « = » que la clé n'a pas.
    expect(Array.from(applicationServerKey("-_8"))).toEqual([251, 255]);
    expect(
      applicationServerKey("BL02ZYTg9YQT0CoVBzU9IMHT8rvWQABwr0DzhDZ_1oF0nV-8PSz0aAchLostwzAJy5mvfbhM9kTVy36ezOwakqw"),
    ).toHaveLength(65);
  });
});

describe("Travailleur autorisé à vider la file", () => {
  const secret = "8Hn0JddMFbXMcr2B833AwtgZdZj252odJGMOGQcJC88";

  it("accepte le jeton exact", () => {
    expect(authorizedPushWorker(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("refuse tout le reste", () => {
    expect(authorizedPushWorker(`Bearer ${secret}x`, secret)).toBe(false);
    expect(authorizedPushWorker(secret, secret)).toBe(false);
    expect(authorizedPushWorker(null, secret)).toBe(false);
    // Sans jeton configuré, la route reste fermée : une variable oubliée ne
    // doit pas ouvrir l'envoi à qui trouve l'adresse.
    expect(authorizedPushWorker("Bearer ", undefined)).toBe(false);
    expect(authorizedPushWorker("Bearer court", "court")).toBe(false);
  });
});
