"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Moon,
  Send,
  Sun,
  Users,
} from "lucide-react";
import { useApp } from "./provider";
import { PageTitle, Panel, Avatar } from "./common";
import { Button } from "./ui/button";
import {
  coverage,
  coverageLevel,
  coverageLevelLabels,
  dateLabel,
  filledDays,
  isOpen,
  isValidated,
  monthDays,
  monthLabel,
  ofMonth,
  plural,
  type Shift,
} from "@/lib/domain";
export function Dashboard() {
  const { state, campaignId, campaign, run, connected } = useApp();
  const [mode, setMode] = useState<"potential" | "planned">("potential");
  const days = monthDays(campaign.month);
  const respondents = state.agents.filter(a => isValidated(state, campaignId, a.id));
  const pending = state.agents.filter(a => !isValidated(state, campaignId, a.id));
  const data = days.flatMap(date =>
    (["DAY", "NIGHT"] as Shift[]).map(shift => ({ date, shift, ...coverage(state, campaignId, date, shift, mode) })),
  );
  // A shift without requirement is neither covered nor in deficit: it is left out
  // of both counts rather than measured against a figure nobody recorded.
  const measured = data.filter(c => c.defined);
  const dayDeficits = measured.filter(c => c.shift === "DAY" && !c.covered).length;
  const nightDeficits = measured.filter(c => c.shift === "NIGHT" && !c.covered).length;
  const covered = measured.filter(c => c.covered).length;
  const unset = data.length - measured.length;
  const percent = Math.round((respondents.length / state.agents.length) * 100);
  return (
    <>
      <PageTitle
        eyebrow="VUE D’ENSEMBLE"
        title="Une équipe prête, ensemble."
        description={`Pilotez les disponibilités et la couverture ${ofMonth(campaign.month)}.`}
        action={
          <Button asChild>
            <Link href="/planning">
              <CalendarCheck2 size={17} />
              Construire le planning
              <ArrowRight size={17} />
            </Link>
          </Button>
        }
      />
      <div className="campaign-ribbon">
        <div className="ribbon-icon">
          <CalendarCheck2 size={22} />
        </div>
        <div>
          <strong>{campaign.name}</strong>
          <span>
            {isOpen(campaign) ? "La campagne est ouverte" : "La campagne est fermée"} · Réponses jusqu’au{" "}
            {dateLabel(campaign.closesOn)}
          </span>
        </div>
        <span className={`pill ${isOpen(campaign) ? "pill-green" : "pill-gray"}`}>
          <span className="live-dot" />
          {isOpen(campaign) ? "En cours" : "Clôturée"}
        </span>
        <Link href="/campagnes">
          Gérer la campagne
          <ChevronRight size={17} />
        </Link>
      </div>
      <div className="section-toolbar">
        <div className="segmented" aria-label="Mesure de couverture">
          <button
            aria-pressed={mode === "potential"}
            className={mode === "potential" ? "selected" : ""}
            onClick={() => setMode("potential")}
          >
            Couverture potentielle
          </button>
          <button
            aria-pressed={mode === "planned"}
            className={mode === "planned" ? "selected" : ""}
            onClick={() => setMode("planned")}
          >
            Couverture planifiée
          </button>
        </div>
        <span className="muted small">
          {mode === "potential" ? "Disponibilités validées" : "Affectations du brouillon"} · effectifs et qualifications
        </span>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">
            Réponses validées
            <span className="stat-icon blue">
              <Users size={19} />
            </span>
          </div>
          <div className="stat-number">
            {respondents.length}
            <span>/ {state.agents.length}</span>
            <span className="stat-badge">{percent} %</span>
          </div>
          <div className="mini-progress">
            <i style={{ width: `${percent}%` }} />
          </div>
          <p>
            <span className="text-blue">
              {pending.length} {plural(pending.length, "réponse")}
            </span>{" "}
            {plural(pending.length, "reste", "restent")} à valider
          </p>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Journées en déficit
            <span className="stat-icon orange">
              <Sun size={20} />
            </span>
          </div>
          <div className="stat-number">
            {dayDeficits}
            <span>{plural(dayDeficits, "journée")}</span>
          </div>
          <p>
            <span className="dot orange" />
            {mode === "potential" ? "Disponibilités à compléter" : "Affectations à compléter"}
          </p>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Nuits en déficit
            <span className="stat-icon purple">
              <Moon size={19} />
            </span>
          </div>
          <div className="stat-number">
            {nightDeficits}
            <span>{plural(nightDeficits, "nuit")}</span>
          </div>
          <p>
            <span className="dot purple" />
            {mode === "potential" ? "Disponibilités à compléter" : "Affectations à compléter"}
          </p>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Créneaux couverts
            <span className="stat-icon green">
              <Check size={20} />
            </span>
          </div>
          <div className="stat-number">
            {covered}
            <span>/ {measured.length}</span>
          </div>
          <p>
            <span className={`dot ${measured.length ? "green" : "gray"}`} />
            {measured.length
              ? `${Math.round((covered / measured.length) * 100)} % de couverture ${mode === "potential" ? "potentielle" : "planifiée"}`
              : "Aucun besoin défini sur le mois"}
          </p>
          {unset > 0 && (
            <p className="muted small">
              {unset} {plural(unset, "créneau", "créneaux")} sans besoins définis
            </p>
          )}
        </div>
      </div>
      <Panel
        title="La couverture, jour après jour"
        subtitle={`${monthLabel(campaign.month)} · ${mode === "potential" ? "Potentielle — réponses validées" : "Planifiée — brouillon"}`}
        action={
          <div className="coverage-legend">
            <span>
              <i className="covered" />
              Couvert
            </span>
            <span>
              <i className="tight" />
              Limite
            </span>
            <span>
              <i className="deficit" />
              Déficit
            </span>
            <span>
              <i className="unset" />
              Besoins non définis
            </span>
          </div>
        }
      >
        <div className="heatmap-scroll">
          <div className="heatmap">
            <div className="heatmap-label" />
            {days.map(date => (
              <div
                key={date}
                className={`heatmap-date ${[0, 6].includes(new Date(`${date}T12:00`).getDay()) ? "weekend" : ""}`}
              >
                <small>{dateLabel(date, { weekday: "short" }).slice(0, 1)}</small>
                <b>{Number(date.slice(-2))}</b>
              </div>
            ))}
            {(["DAY", "NIGHT"] as Shift[]).map(shift => (
              <div className="heatmap-row" key={shift}>
                <div className="heatmap-label">
                  {shift === "DAY" ? <Sun size={15} /> : <Moon size={15} />}
                  {shift === "DAY" ? "Jour" : "Nuit"}
                </div>
                {days.map(date => {
                  const c = coverage(state, campaignId, date, shift, mode);
                  const level = coverageLevel(c);
                  const slot = `${dateLabel(date)} ${shift === "DAY" ? "jour" : "nuit"}`;
                  return (
                    <Link
                      key={date}
                      className={`heatmap-cell ${level}`}
                      href={`/planning?date=${date}&shift=${shift}`}
                      aria-label={
                        c.defined
                          ? `${slot} : ${c.actual} sur ${c.need}, ${coverageLevelLabels[level].toLowerCase()}`
                          : `${slot} : besoins non définis`
                      }
                      title={
                        c.defined
                          ? `${c.actual}/${c.need} agents · ${level === "tight" ? "Couvert sans marge" : coverageLevelLabels[level]}`
                          : "Besoins non définis pour ce créneau"
                      }
                    >
                      {c.actual}
                      <small>/{c.defined ? c.need : "—"}</small>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="panel-footnote">
          <CircleAlert size={14} />
          Un créneau est couvert lorsque les effectifs et les qualifications sont réunis. Sans besoins définis, il n’est
          ni couvert ni en déficit.
          <Link href="/disponibilites">
            Voir les disponibilités
            <ArrowRight size={14} />
          </Link>
        </div>
      </Panel>
      <div className="dashboard-bottom">
        <Panel
          title="La mobilisation de votre équipe"
          subtitle="Seules les réponses explicitement validées sont comptabilisées."
          action={
            <span className="pill pill-blue">
              {state.agents.length} {plural(state.agents.length, "agent")}
            </span>
          }
        >
          <div className="response-overview">
            <div className="donut" style={{ background: `conic-gradient(var(--blue) ${percent}%, #edf1f7 0)` }}>
              <div>
                <strong>
                  {percent}
                  <small>%</small>
                </strong>
                <span>ont validé</span>
              </div>
            </div>
            <div className="response-counts">
              <div>
                <span>
                  <i className="dot blue" />
                  Réponses validées
                </span>
                <strong>{respondents.length}</strong>
              </div>
              <div>
                <span>
                  <i className="dot gray" />
                  En attente de validation
                </span>
                <strong>{pending.length}</strong>
              </div>
              <Link href="/disponibilites">
                Consulter la synthèse
                <ArrowRight size={15} />
              </Link>
              {/* Nobody runs a clock, so the reminder is an act. The database
                  picks the targets and refuses to pile two on the same person. */}
              {connected && pending.length > 0 && (
                <Button variant="secondary" onClick={() => run({ type: "remind", campaignId })}>
                  <Send size={15} />
                  Relancer {pending.length} {plural(pending.length, "agent")}
                </Button>
              )}
            </div>
          </div>
          <div className="pending-list">
            {pending.slice(0, 3).map(a => (
              <div key={a.id}>
                <Avatar agent={a} />
                <span>
                  <strong>{a.name}</strong>
                  <small>{a.team}</small>
                </span>
                <span className="pending-progress">
                  {filledDays(state, campaign, a.id)}/{days.length} jours saisis
                </span>
                <Clock3 size={15} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Votre prochaine étape" subtitle="De la disponibilité au planning publié.">
          <div className="next-step">
            <span className="step-number">01</span>
            <div>
              <h3>Compléter les affectations</h3>
              <p>Comparez les agents disponibles aux besoins de chaque garde.</p>
              <Button variant="secondary" asChild>
                <Link href="/planning">
                  Ouvrir le planning
                  <ArrowRight size={16} />
                </Link>
              </Button>
            </div>
          </div>
          <div className="next-step">
            <span className="step-number muted-step">02</span>
            <div>
              <h3>Publier les créneaux couverts</h3>
              <p>Les agents retrouvent uniquement les gardes publiées dans leur planning.</p>
            </div>
          </div>
          <div className="small-note">
            <ShieldIcon />
            Une disponibilité est une possibilité.
            <br />
            Une affectation est un engagement au planning.
          </div>
        </Panel>
      </div>
    </>
  );
}
function ShieldIcon() {
  return <CalendarCheck2 size={20} />;
}
