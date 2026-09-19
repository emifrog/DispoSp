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
import { PageTitle, Panel, Avatar, ProgressRing, SegmentedTabs } from "./common";
import { Button } from "./ui/button";
import {
  coverage,
  coverageLevel,
  coverageLevelLabels,
  dateLabel,
  filledDays,
  isOpen,
  isValidated,
  localDate,
  monthDays,
  monthLabel,
  ofMonth,
  plural,
  type Shift,
} from "@/lib/domain";
export function Dashboard() {
  const { state, campaignId, campaign, run } = useApp();
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
  // Les échéances ne sortent pas de la campagne affichée mais de toutes celles
  // que la base porte : c'est en octobre qu'on doit voir arriver la clôture de
  // novembre. Rien n'est inventé — chaque ligne est une date déjà enregistrée.
  const today = localDate();
  const deadlines = state.campaigns
    .flatMap(c => [
      { date: c.opensOn, label: "Ouverture des réponses", campaign: c.name },
      { date: c.closesOn, label: "Clôture des réponses", campaign: c.name },
      { date: `${c.month}-01`, label: "Début du mois couvert", campaign: c.name },
    ])
    .filter(d => d.date >= today)
    .map(d => ({
      ...d,
      days: Math.round((Date.parse(`${d.date}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86400000),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);
  return (
    <>
      <PageTitle
        title="Tableau de bord"
        description={`Réponses et couverture ${ofMonth(campaign.month)}, jour et nuit.`}
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
        <SegmentedTabs
          label="Mesure de couverture"
          value={mode}
          onChange={setMode}
          options={[
            { value: "potential", label: "Couverture potentielle" },
            { value: "planned", label: "Couverture planifiée" },
          ]}
        />
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
        title="Couverture par créneau"
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
          title="État des réponses"
          subtitle="Seules les réponses explicitement validées sont comptabilisées."
          action={
            <span className="pill pill-blue">
              {state.agents.length} {plural(state.agents.length, "agent")}
            </span>
          }
        >
          <div className="response-overview">
            <ProgressRing percent={percent} caption="ont validé" />
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
              {pending.length > 0 && (
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
        <Panel
          title="Couverture des besoins"
          subtitle={
            mode === "potential"
              ? "Sur les disponibilités validées, créneau par créneau."
              : "Sur les affectations du brouillon, créneau par créneau."
          }
          action={
            <span className="pill pill-gray">
              {measured.length} {plural(measured.length, "créneau", "créneaux")} {plural(measured.length, "mesuré")}
            </span>
          }
        >
          <div className="response-overview">
            <ProgressRing
              percent={measured.length ? (covered / measured.length) * 100 : 0}
              tone="green"
              caption="couverts"
            />
            <div className="response-counts">
              <div>
                <span>
                  <i className="dot green" />
                  Créneaux couverts
                </span>
                <strong>{covered}</strong>
              </div>
              <div>
                <span>
                  <i className="dot orange" />
                  En déficit
                </span>
                <strong>{measured.length - covered}</strong>
              </div>
              {/* Un créneau sans besoin enregistré n'est ni couvert ni en
                  déficit : il est hors mesure, et le dire évite de lire un
                  pourcentage comme s'il portait sur tout le mois. */}
              <div>
                <span>
                  <i className="dot gray" />
                  Besoins non définis
                </span>
                <strong>{unset}</strong>
              </div>
              <Link href="/planning">
                Compléter les affectations
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </Panel>
        <Panel title="Prochaines échéances" subtitle="Les dates qui engagent, tous mois confondus.">
          {!deadlines.length ? (
            <div className="empty-small">Aucune échéance à venir sur les campagnes enregistrées.</div>
          ) : (
            <div className="deadline-list">
              {deadlines.map(d => (
                <div key={`${d.date}-${d.label}`}>
                  <span className="deadline-date">
                    <strong>{Number(d.date.slice(-2))}</strong>
                    <small>{dateLabel(d.date, { month: "short" })}</small>
                  </span>
                  <span className="deadline-body">
                    <strong>{d.label}</strong>
                    <small>{d.campaign}</small>
                  </span>
                  <span className={`pill ${d.days <= 2 ? "pill-red" : d.days <= 7 ? "pill-orange" : "pill-gray"}`}>
                    {d.days === 0 ? "aujourd’hui" : d.days === 1 ? "demain" : `dans ${d.days} jours`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Étapes suivantes" subtitle="Du recueil des disponibilités au planning publié.">
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
