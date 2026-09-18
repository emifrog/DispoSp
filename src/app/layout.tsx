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
  title: "DISPO SP — Disponibilités & planning",
  description: "La disponibilité de chacun, la force du collectif. Planification des équipes de sapeurs-pompiers.",
  robots: { index: false, follow: false },
  applicationName: "DISPO SP",
  // iOS ignore le manifeste pour l'écran d'accueil : il lui faut son icône et
  // son propre drapeau de plein écran.
  appleWebApp: { capable: true, title: "DISPO SP", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  // La teinte de la barre d'état, une fois l'application installée.
  themeColor: "#142b50",
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
