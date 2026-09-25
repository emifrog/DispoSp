import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import { ServiceWorker } from "@/components/pwa";
import "./globals.css";
// Téléchargée à la construction et servie depuis l'application : aucune requête
// vers un tiers au chargement d'une page, et rien à demander à l'utilisateur.
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
  fallback: ["Segoe UI", "Arial", "Helvetica", "sans-serif"],
});
export const metadata: Metadata = {
  // Chaque page donne son nom, suivi de celui de l'application : tous les
  // onglets s'appelaient pareil, et l'historique du navigateur comme le lecteur
  // d'écran à l'arrivée sur une page ne disaient pas laquelle c'était.
  title: { template: "%s · DispoSP", default: "DispoSP — Disponibilités & planning" },
  description: "La disponibilité de chacun, la force du collectif. Planification des équipes de sapeurs-pompiers.",
  robots: { index: false, follow: false },
  applicationName: "DispoSP",
  // iOS ignore le manifeste pour l'écran d'accueil : il lui faut son icône et
  // son propre drapeau de plein écran.
  //
  // `default` et non `black-translucent` : ce dernier fait passer la page sous
  // la barre d'état et y écrit l'heure en blanc. La barre du haut de DispoSP,
  // blanche, se retrouvait sous l'heure et l'encoche, avec une heure blanche sur
  // fond blanc — rien dans la feuille de style ne réserve la hauteur de la
  // barre d'état. Avec `default`, la page commence sous elle.
  appleWebApp: { capable: true, title: "DispoSP", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  // La teinte de la barre d'état, une fois l'application installée.
  themeColor: "#08284a",
  // viewport-fit pour que le fond passe sous l'encoche plutôt que de s'arrêter
  // sur une bande blanche.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={roboto.variable}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
