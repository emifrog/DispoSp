import Link from "next/link";
export default function NotFound() { return <main className="empty-state"><h1>Cette page n’existe pas.</h1><Link href="/tableau-de-bord">Revenir au tableau de bord</Link></main>; }
