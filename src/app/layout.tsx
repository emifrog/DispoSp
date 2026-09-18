import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "DISPO SP — Disponibilités & planning", description: "La disponibilité de chacun, la force du collectif. Planification des équipes de sapeurs-pompiers.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="fr"><body>{children}</body></html>; }
