"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
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
  Menu,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Brand } from "./brand";
import { useApp } from "./provider";
import { Button } from "./ui/button";
import { monthLabel } from "@/lib/domain";
const managerNav = [
  { href: "/tableau-de-bord", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/disponibilites", label: "Disponibilités", icon: CalendarDays },
  { href: "/planning", label: "Planning", icon: CalendarCheck2 },
  { href: "/campagnes", label: "Campagnes", icon: Megaphone },
  { href: "/agents", label: "Agents & équipes", icon: Users },
];
const agentNav = [
  { href: "/mes-disponibilites", label: "Disponibilités", icon: CalendarDays },
  { href: "/mon-planning", label: "Mon planning", icon: CalendarCheck2 },
  { href: "/profil", label: "Mon profil", icon: UserRound },
];
export function Shell({ children }: { children: ReactNode }) {
  const { state, actor, switchRole, campaignId, setCampaignId, ready } = useApp();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const nav = actor.role === "MANAGER" ? managerNav : agentNav;
  const agent = state.agents.find(a => a.id === actor.id)!;
  const managerOnly = [...managerNav.map(n => n.href), "/historique", "/parametres"].includes(path);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      {menu && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setMenu(false)} />}
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
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
            <small>Centre de secours</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-caption">ESPACE {actor.role === "MANAGER" ? "RESPONSABLE" : "AGENT"}</span>
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
        {actor.role === "MANAGER" && (
          <>
            <span className="nav-caption nav-caption-second">ADMINISTRATION</span>
            <nav aria-label="Administration">
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
          <div className="team-note">
            <ShieldCheck size={23} />
            <strong>Chaque présence compte.</strong>
            <p>
              Une équipe disponible,
              <br />
              un territoire protégé.
            </p>
          </div>
          <span className="version">
            DISPO SP <span>Première version · 0.1</span>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button className="mobile-only icon-button" aria-label="Ouvrir le menu" onClick={() => setMenu(true)}>
            <Menu />
          </button>
          <div className="breadcrumb">
            Espace de travail <span>/</span>{" "}
            <strong>
              {[
                ...managerNav,
                ...agentNav,
                { href: "/historique", label: "Historique" },
                { href: "/parametres", label: "Paramètres" },
              ].find(n => n.href === path)?.label ?? "DISPO SP"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-tag">
              <span />
              Démo locale
            </span>
            <label className="role-switch">
              <span className="sr-only">Espace de démonstration</span>
              <select
                aria-label="Espace de démonstration"
                value={actor.role}
                onChange={e => switchRole(e.target.value as typeof actor.role)}
              >
                <option value="MANAGER">Responsable</option>
                <option value="AGENT">Agent</option>
              </select>
            </label>
            <span className="topbar-divider" />
            <div className="user-avatar">
              {agent.name
                .split(" ")
                .map(n => n[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="user-name">
              <strong>{agent.name}</strong>
              <small>{actor.role === "MANAGER" ? "Responsable de centre" : agent.grade}</small>
            </div>
          </div>
        </header>
        <div className="demo-banner">
          Espace de démonstration · données fictives sauvegardées dans ce navigateur.
          <Link href={actor.role === "MANAGER" ? "/mes-disponibilites" : "/profil"}>
            {actor.role === "MANAGER" ? "Tester ma saisie agent" : "Changer d’agent"}
            <ArrowUpRight size={14} />
          </Link>
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
                    {monthLabel(c.month)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!ready ? (
            <div className="loading-state">Chargement de votre espace…</div>
          ) : actor.role === "AGENT" && managerOnly ? (
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
        <footer className="page-footer">
          <span>DISPO SP · Plus loin, ensemble.</span>
          <span>Horaires en heure de Paris</span>
        </footer>
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
