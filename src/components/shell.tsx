"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  LayoutDashboard,
  CalendarDays,
  CalendarCheck2,
  Users,
  Megaphone,
  Settings2,
  History,
  ChevronDown,
  ArrowUpRight,
  ShieldCheck,
  UserRound,
  Flame,
  Home,
  Inbox,
  LogOut,
  Menu,
  TrendingUp,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Brand, BrandMark } from "./brand";
import { useApp } from "./provider";
import { Button } from "./ui/button";
import { monthLabel } from "@/lib/domain";
import { roleLabels, type AttachedSession } from "@/lib/session";
const managerNav = [
  { href: "/tableau-de-bord", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/disponibilites", label: "Disponibilités", icon: CalendarDays },
  { href: "/planning", label: "Planning", icon: CalendarCheck2 },
  { href: "/besoins", label: "Besoins", icon: BarChart3 },
  { href: "/campagnes", label: "Campagnes", icon: Megaphone },
  { href: "/agents", label: "Agents & équipes", icon: Users },
];
// L'ordre compte deux fois : la barre latérale montre tout, la barre du bas sur
// mobile ne garde que les quatre premiers. Notifications vient donc en dernier —
// la cloche de la barre du haut y mène déjà, sur téléphone comme ailleurs.
const agentNav = [
  { href: "/accueil", label: "Accueil", icon: Home },
  { href: "/mes-disponibilites", label: "Disponibilités", icon: CalendarDays },
  { href: "/mon-planning", label: "Mon planning", icon: CalendarCheck2 },
  { href: "/profil", label: "Mon profil", icon: UserRound },
  { href: "/notifications", label: "Notifications", icon: Bell },
];
const initials = (name: string) =>
  name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map(part => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/**
 * La teinte de l'étiquette de rôle, du gris au marine.
 *
 * Nommée ici et non calculée à partir du rôle : un rôle que le schéma ajouterait
 * demain — ou le `RESPONSABLE` que la migration du 19 septembre a retiré et
 * qu'une base pas encore migrée porterait encore — retombe sur le gris neutre,
 * plutôt que sur une classe CSS qui n'existe pas.
 */
const roleTones: Record<string, string> = { ADMIN: "is-admin", GESTIONNAIRE: "is-gestionnaire" };

export function Shell({ children, session }: { children: ReactNode; session: AttachedSession }) {
  const { state, actor, campaignId, setCampaignId, memberRole, canAdminister } = useApp();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const nav = actor.role === "MANAGER" ? managerNav : agentNav;
  const managerOnly = [...managerNav.map(n => n.href), "/historique", "/parametres"].includes(path);
  // §2 has four roles. A responsable manages their team but administers nothing,
  // so the two administration entries would only lead to screens refusing them.
  const space = roleLabels[memberRole].toUpperCase();
  const unread = state.notifications.filter(n => !n.readAt).length;
  // Une demande en attente bloque quelqu'un : elle se compte dans la barre,
  // pas seulement sur son écran.
  const pendingWithdrawals = state.withdrawals.filter(w => w.state === "PENDING").length;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      {menu && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setMenu(false)} />}
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand variant="onDark" />
          <button className="mobile-only icon-button" aria-label="Fermer le menu" onClick={() => setMenu(false)}>
            <X />
          </button>
        </div>
        <div className="workspace">
          <span className="workspace-icon">
            <Flame size={19} />
          </span>
          <div>
            <strong>{state.organization.name}</strong>
            {/*<small>Centre de secours</small>*/}
          </div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-caption">ESPACE {space}</span>
        <nav aria-label="Navigation principale">
          {nav.map(item => (
            <Link
              aria-current={path === item.href ? "page" : undefined}
              key={item.href}
              className={`nav-item ${path === item.href ? "active" : ""}`}
              href={item.href}
              onClick={() => setMenu(false)}
            >
              <item.icon size={20} />
              {item.label}
              {path === item.href && <span className="active-dot" />}
            </Link>
          ))}
        </nav>
        {actor.role === "MANAGER" && canAdminister && (
          <>
            <span className="nav-caption nav-caption-second">ADMINISTRATION</span>
            <nav aria-label="Administration">
              <Link
                className={`nav-item ${path === "/demandes" ? "active" : ""}`}
                href="/demandes"
                onClick={() => setMenu(false)}
              >
                <Inbox size={19} />
                Demandes
                {pendingWithdrawals > 0 && <span className="nav-badge">{pendingWithdrawals}</span>}
              </Link>
              <Link
                className={`nav-item ${path === "/statistiques" ? "active" : ""}`}
                href="/statistiques"
                onClick={() => setMenu(false)}
              >
                <TrendingUp size={19} />
                Statistiques
              </Link>
              <Link
                className={`nav-item ${path === "/historique" ? "active" : ""}`}
                href="/historique"
                onClick={() => setMenu(false)}
              >
                <History size={19} />
                Historique
              </Link>
              <Link
                className={`nav-item ${path === "/parametres" ? "active" : ""}`}
                href="/parametres"
                onClick={() => setMenu(false)}
              >
                <Settings2 size={19} />
                Paramètres
              </Link>
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <span className="version">
            DispoSP <span>Version · 1.0</span>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button className="mobile-only icon-button" aria-label="Ouvrir le menu" onClick={() => setMenu(true)}>
            <Menu />
          </button>
          {/* Sur un téléphone, la barre latérale est escamotée et le fil
              d'Ariane masqué : sans cela, l'application ne porterait jamais son
              nom sur l'appareil par lequel la plupart des agents y viennent. */}
          <div className="topbar-brand">
            <BrandMark size={28} />
          </div>
          <div className="breadcrumb">
            Espace de travail <span>/</span>{" "}
            <strong>
              {[
                ...managerNav,
                ...agentNav,
                { href: "/demandes", label: "Demandes" },
                { href: "/statistiques", label: "Statistiques" },
                { href: "/historique", label: "Historique" },
                { href: "/parametres", label: "Paramètres" },
              ].find(n => n.href === path)?.label ?? "DispoSP"}
            </strong>
          </div>
          <div className="topbar-actions">
            {/* Everyone receives notices: a manager is an agent too, and it is
                their own publications that reach them. */}
            <Link
              className={`bell ${path === "/notifications" ? "active" : ""}`}
              href="/notifications"
              aria-label={unread ? `Notifications, ${unread} non ${unread > 1 ? "lues" : "lue"}` : "Notifications"}
            >
              <Bell size={19} />
              {unread > 0 && <span className="bell-badge">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            {/* Le rôle plutôt qu'un « Connecté » : l'agent sait qu'il est
                connecté — il vient de saisir son mot de passe —, mais il ne
                sait pas toujours ce que son rôle lui ouvre. Et cette place est
                la seule du bandeau qui reste visible sur un téléphone, où le
                nom et sa ligne disparaissent. */}
            <span className={`role-tag ${roleTones[session.membership.role] ?? ""}`}>
              <span className="sr-only">Rôle : </span>
              {roleLabels[session.membership.role] ?? session.membership.role}
            </span>
            <span className="topbar-divider" />
            <div className="user-avatar">{initials(session.displayName)}</div>
            <div className="user-name">
              <strong>{session.displayName}</strong>
            </div>
            <form method="post" action="/deconnexion">
              <button type="submit" className="button button-ghost button-sm" aria-label="Se déconnecter">
                <LogOut size={17} />
              </button>
            </form>
          </div>
        </header>
        {/*<div className="context-banner">
          {session.membership.organizationName} · {session.membership.teamName} — vos saisies sont enregistrées en base,
          sous les droits de votre rôle.
        </div>*/}
        <div className="print-header" aria-hidden="true">
          <Brand width={132} />
          <span>{state.organization.name}</span>
        </div>
        <main id="main" tabIndex={-1}>
          <div className="campaign-context">
            <span>
              <span className="live-dot" />
              {state.organization.name}
            </span>
            <label>
              <CalendarDays size={15} />
              <span className="sr-only">Campagne active</span>
              <select aria-label="Campagne active" value={campaignId} onChange={e => setCampaignId(e.target.value)}>
                {state.campaigns.map(c => (
                  <option key={c.id} value={c.id}>
                    {/* Le mois suffit, sauf quand deux campagnes le partagent —
                        deux équipes, par exemple : le nom les distingue. */}
                    {state.campaigns.some(o => o.id !== c.id && o.month === c.month)
                      ? `${monthLabel(c.month)} · ${c.name}`
                      : monthLabel(c.month)}
                    {/* Plus ancienne que la fenêtre chargée : elle se charge
                        quand on la choisit, et l'écran le montre un instant. */}
                    {c.archived ? " (archive)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {actor.role === "AGENT" && managerOnly ? (
            <div className="empty-state">
              <ShieldCheck />
              <h1>Espace responsable</h1>
              <p>Votre espace agent contient vos disponibilités et votre planning publié.</p>
              <Button asChild>
                <Link href="/mes-disponibilites">Mes disponibilités</Link>
              </Button>
            </div>
          ) : (
            children
          )}
        </main>
        {/*<footer className="page-footer">
          <span>DispoSP · Plus loin, ensemble.</span>
          <span>Horaires en heure de Paris</span>
        </footer>*/}
      </div>
      <nav className="mobile-nav" aria-label="Navigation mobile">
        {nav.slice(0, 4).map(n => (
          <Link key={n.href} href={n.href} className={path === n.href ? "active" : ""}>
            <n.icon size={21} />
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
