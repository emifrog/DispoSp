"use client";
import Link from "next/link";
import { CalendarCheck2, CalendarDays, ChevronRight, CircleAlert, Settings2, Zap } from "lucide-react";
import { useApp } from "./provider";
import { Panel, ProgressRing } from "./common";
import { Button } from "./ui/button";
import {
  dateLabel,
  filledDays,
  hours,
  isOpen,
  isValidated,
  localDate,
  monthDays,
  monthLabel,
  plural,
  shiftKey,
  type Shift,
} from "@/lib/domain";

/**
 * L'accueil de l'agent : ce qu'il doit faire, et ce qui l'attend.
 *
 * Il ne calcule rien qu'un autre écran ne sache déjà — il rassemble. Le seul
 * parti pris est l'ordre : d'abord ce qui est dû (la campagne en cours et les
 * jours qui manquent), ensuite ce qui est acquis (les gardes publiées), enfin
 * les raccourcis. Un agent qui n'a rien à faire voit ses gardes en premier
 * plan, celui qui est en retard voit d'abord son retard.
 */
export function AgentHome() {
  const { state, actor, agent, campaign, campaignId } = useApp();
  const days = monthDays(campaign.month);
  const filled = filledDays(state, campaign, actor.id);
  const remaining = days.length - filled;
  const percent = days.length ? Math.round((filled / days.length) * 100) : 0;
  const validated = isValidated(state, campaignId, actor.id);
  const open = isOpen(campaign);
  const today = localDate();
  // Les gardes publiées à venir. Un brouillon n'est pas une garde : tant que le
  // gestionnaire n'a pas publié, l'agent n'a rien à lire ici.
  const upcoming = days
    .filter(date => date >= today)
    .flatMap(date =>
      (["DAY", "NIGHT"] as Shift[]).flatMap(shift => {
        const published = state.publications[shiftKey(campaignId, date, shift)];
        return published?.agents.includes(actor.id) ? [{ date, shift }] : [];
      }),
    );
  // Le prénom seul : « Bonjour Julien Bernard » sonne comme une convocation.
  const firstName = (agent?.name ?? "").split(" ")[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Bonjour {firstName}
            <span aria-hidden="true"> 👋</span>
          </h1>
          <p>Voici un aperçu de vos disponibilités et de vos prochains services.</p>
        </div>
      </div>

      <Panel
        title="Campagne en cours"
        subtitle={`${campaign.name} · du ${dateLabel(days[0])} au ${dateLabel(days[days.length - 1])}`}
        className="home-campaign"
        action={
          remaining > 0 && open ? (
            <span className="pill pill-red">
              <CircleAlert size={14} />
              {remaining} {plural(remaining, "jour")} {plural(remaining, "restant")} à renseigner
            </span>
          ) : (
            <span className={`pill ${validated ? "pill-green" : "pill-gray"}`}>
              {validated ? "Réponse validée" : open ? "À valider" : "Campagne clôturée"}
            </span>
          )
        }
      >
        <div className="home-progress">
          <ProgressRing percent={percent} size="md" caption="renseignés" />
          <div className="home-progress-body">
            <strong>
              {filled} / {days.length} {plural(days.length, "jour")} {plural(days.length, "renseigné")}
            </strong>
            <div className="mini-progress">
              <i style={{ width: `${percent}%` }} />
            </div>
            <p className="muted small">
              {!open
                ? "La campagne est clôturée. Vos disponibilités restent consultables."
                : validated
                  ? "Toute modification nécessitera une nouvelle validation."
                  : `Réponses attendues jusqu’au ${dateLabel(campaign.closesOn)}.`}
            </p>
          </div>
        </div>
        <Button className="full-width" asChild>
          <Link href="/mes-disponibilites">
            <Zap size={17} />
            Renseigner mes disponibilités
            <ChevronRight size={17} />
          </Link>
        </Button>
      </Panel>

      <Panel
        title="Mon planning"
        subtitle="Vos prochains services affectés"
        action={
          <Link className="panel-link" href="/mon-planning">
            Voir tout
            <ChevronRight size={16} />
          </Link>
        }
      >
        {!upcoming.length ? (
          <div className="empty-small">
            Aucune garde publiée à venir sur {monthLabel(campaign.month)}. Elles apparaîtront ici dès que le
            gestionnaire aura publié le planning.
          </div>
        ) : (
          <div className="home-shifts">
            {upcoming.slice(0, 3).map(s => (
              <Link key={`${s.date}-${s.shift}`} href="/mon-planning">
                <span className={`shift-date ${s.shift === "DAY" ? "day" : "night"}`}>
                  <small>{dateLabel(s.date, { weekday: "short" })}</small>
                  <strong>{Number(s.date.slice(-2))}</strong>
                  <small>{dateLabel(s.date, { month: "short" })}</small>
                </span>
                <span className="home-shift-body">
                  <strong>Garde {s.shift === "DAY" ? "de jour" : "de nuit"}</strong>
                  <small>{state.organization.name}</small>
                </span>
                <span className="home-shift-hours">{hours(campaign, s.shift)}</span>
                <ChevronRight size={17} />
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <h2 className="home-section">Accès rapides</h2>
      <p className="home-section-caption">Gagnez du temps au quotidien</p>
      <div className="home-shortcuts">
        <Link className="shortcut shortcut-primary" href="/mes-disponibilites?saisie=rapide">
          <span className="shortcut-icon">
            <Zap size={20} />
          </span>
          <span>
            <strong>Saisie rapide</strong>
            <small>Renseigner plusieurs jours en une fois</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link className="shortcut" href="/mes-disponibilites#modele">
          <span className="shortcut-icon">
            <Settings2 size={20} />
          </span>
          <span>
            <strong>Ma disponibilité habituelle</strong>
            <small>Appliquer un modèle récurrent</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link className="shortcut" href="/mon-planning">
          <span className="shortcut-icon">
            <CalendarCheck2 size={20} />
          </span>
          <span>
            <strong>Mon planning</strong>
            <small>Exporter mes gardes vers mon agenda</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link className="shortcut" href="/mes-disponibilites">
          <span className="shortcut-icon">
            <CalendarDays size={20} />
          </span>
          <span>
            <strong>Le mois en entier</strong>
            <small>Voir et corriger jour par jour</small>
          </span>
          <ChevronRight size={18} />
        </Link>
      </div>
    </>
  );
}
