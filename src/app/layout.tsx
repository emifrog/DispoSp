import type { Metadata } from "next";
import { Roboto } from "next/font/google";
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
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={roboto.variable}>
      <body>{children}</body>
    </html>
  );
}
