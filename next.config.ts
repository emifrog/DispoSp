import type { NextConfig } from "next";

/*
 * Politique de sécurité du contenu, sans nonce.
 *
 * La variante à nonce oblige à rendre chaque page à la requête : la page hors
 * ligne, que l'agent de service garde en cache, et les autres pages publiques
 * sont prérendues, et leurs scripts sans nonce seraient bloqués — l'application
 * ne démarrerait plus. Voir
 * `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`.
 *
 * Ce que celle-ci ferme malgré `'unsafe-inline'` : aucun script ni style venu
 * d'une autre origine, aucune requête vers un autre serveur que l'application
 * et son projet Supabase, aucun cadre, aucun objet, aucun formulaire envoyé
 * ailleurs, aucune balise <base> détournée. Les styles en ligne restent
 * permis : les barres de progression posent leur largeur par `style`.
 *
 * `upgrade-insecure-requests` n'y est pas : les tests de bout en bout servent
 * l'application en HTTP sur 127.0.0.1. HSTS fait ce travail en production.
 */
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
const development = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  // React ne se sert d'eval qu'en développement, pour ses piles d'erreur.
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  // Le client Supabase du navigateur : connexion, SSO, mot de passe oublié.
  `connect-src 'self'${supabase ? ` ${supabase}` : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          // Un an, sans includeSubDomains ni preload : l'application sera
          // souvent servie sous le domaine d'un SDIS, dont d'autres
          // sous-domaines ne parlent peut-être pas HTTPS. Un navigateur ignore
          // cet en-tête reçu en HTTP ; il ne gêne donc pas le développement.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        // L'agent de service est ce qui reçoit les notifications poussées. Un
        // navigateur qui garderait en cache une version d'hier continuerait de
        // les traiter avec l'ancien code, parfois des jours durant : il doit
        // aller voir à chaque fois.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};
export default config;
