"use client";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  Check,
  CircleAlert,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useApp } from "./provider";
import { PageTitle, Panel, Avatar } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import {
  availableAgents,
  coverage,
  dateLabel,
  hours,
  monthDays,
  requirement,
  shiftKey,
  type Agent,
  type Shift,
} from "@/lib/domain";

export function Planning() {
  const { state, campaignId, campaign, run } = useApp();
  const days = monthDays(campaign.month);
  const [selectedDate, setDate] = useState(() =>
    typeof window === "undefined" ? days[14] : (new URLSearchParams(window.location.search).get("date") ?? days[14]),
  );
  const [shift, setShift] = useState<Shift>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("shift") === "NIGHT"
      ? "NIGHT"
      : "DAY",
  );
  const [search, setSearch] = useState("");
  const [needsOpen, setNeedsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const date = days.includes(selectedDate) ? selectedDate : days[0];
  const key = shiftKey(campaignId, date, shift);
  const need = requirement(state, campaignId, date, shift);
  const [total, setTotal] = useState(need.total);
  const [qualifications, setQualifications] = useState<Record<string, number>>(need.qualifications);
  const pool = availableAgents(state, campaignId, date, shift);
  const assignedIds = state.assignments[key] ?? [];
  const assigned = state.agents.filter(a => assignedIds.includes(a.id));
  const candidates = pool.filter(
    a =>
      !assignedIds.includes(a.id) &&
      `${a.name} ${a.grade} ${a.qualifications.join(" ")}`
        .toLocaleLowerCase("fr")
        .includes(search.toLocaleLowerCase("fr")),
  );
  const result = coverage(state, campaignId, date, shift, "planned");
  const published = state.publications[key];
  const changed = published && JSON.stringify([...published.agents].sort()) !== JSON.stringify([...assignedIds].sort());
  function openNeeds() {
    setTotal(need.total);
    setQualifications(need.qualifications);
    setNeedsOpen(true);
  }
  function agentCard(agent: Agent, retained: boolean) {
    return (
      <div
        className={`agent-card ${result.invalid.some(a => a.id === agent.id) && retained ? "invalid-assignment" : ""}`}
        key={agent.id}
      >
        <Avatar agent={agent} />
        <div className="agent-info">
          <strong>{agent.name}</strong>
          <small>
            {agent.grade} · {agent.team.replace("Équipe ", "")}
          </small>
          <div className="qualification-tags">
            {agent.qualifications.map(q => (
              <span key={q} className={q === "Chef" ? "chief" : q === "Conducteur PL" ? "driver" : ""}>
                {q}
              </span>
            ))}
          </div>
        </div>
        <Button
          size="icon"
          variant={retained ? "ghost" : "secondary"}
          aria-label={`${retained ? "Retirer" : "Affecter"} ${agent.name}`}
          onClick={() => run({ type: "assign", campaignId, date, shift, userId: agent.id, remove: retained })}
        >
          {retained ? <Trash2 size={16} /> : <Plus size={18} />}
        </Button>
      </div>
    );
  }
  return (
    <>
      <PageTitle
        eyebrow="PLANIFICATION"
        title="Construire le planning"
        description="Les bonnes compétences, au bon moment. Affectez les agents disponibles."
        action={
          <span className={`pill ${published ? "pill-green" : "pill-gray"}`}>
            {published
              ? `Version ${published.revision} publiée${changed ? " · brouillon modifié" : ""}`
              : "Brouillon non publié"}
          </span>
        }
      />
      <div className="planning-toolbar">
        <div className="date-navigation">
          <Button
            size="icon"
            variant="secondary"
            aria-label="Jour précédent"
            disabled={date === days[0]}
            onClick={() => setDate(days[days.indexOf(date) - 1])}
          >
            <ArrowLeft size={17} />
          </Button>
          <label>
            <span className="sr-only">Date du créneau</span>
            <input
              aria-label="Date du créneau"
              type="date"
              min={days[0]}
              max={days[days.length - 1]}
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </label>
          <Button
            size="icon"
            variant="secondary"
            aria-label="Jour suivant"
            disabled={date === days[days.length - 1]}
            onClick={() => setDate(days[days.indexOf(date) + 1])}
          >
            <ArrowRight size={17} />
          </Button>
        </div>
        <div className="segmented">
          <button
            className={shift === "DAY" ? "selected" : ""}
            aria-pressed={shift === "DAY"}
            onClick={() => setShift("DAY")}
          >
            Jour
          </button>
          <button
            className={shift === "NIGHT" ? "selected" : ""}
            aria-pressed={shift === "NIGHT"}
            onClick={() => setShift("NIGHT")}
          >
            Nuit
          </button>
        </div>
        <span className="muted">{hours(campaign, shift)}</span>
      </div>
      {changed && (
        <div className="warning">
          <CircleAlert size={18} />
          Le brouillon a changé. Les agents voient toujours la version {published.revision} jusqu’à la prochaine
          publication.
        </div>
      )}
      <div className="planning-grid">
        <Panel
          title="Agents disponibles"
          subtitle="Réponses validées pour ce créneau"
          action={<span className="count-badge">{pool.length}</span>}
        >
          <label className="search-field">
            <Search size={16} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Nom, grade, qualification…"
              aria-label="Rechercher un agent disponible"
            />
          </label>
          <div className="agent-card-list">
            {candidates.map(a => agentCard(a, false))}
            {!candidates.length && (
              <div className="empty-small">
                <Users />
                <p>
                  {pool.length
                    ? "Tous les agents correspondants sont affectés."
                    : "Aucune disponibilité validée pour ce créneau."}
                </p>
              </div>
            )}
          </div>
        </Panel>
        <Panel
          title="Agents affectés"
          subtitle="Affectations du brouillon"
          action={
            <span className="pill pill-blue">
              {assigned.length} / {need.total}
            </span>
          }
        >
          <div className="agent-card-list">
            {assigned.map(a => agentCard(a, true))}
            <div className="assignment-placeholder">
              <Plus size={24} />
              <p>
                Sélectionnez un agent disponible
                <br />
                avec le bouton +.
              </p>
            </div>
          </div>
        </Panel>
        <Panel
          title="Besoins de la garde"
          subtitle="Couverture planifiée du brouillon"
          action={
            <Button size="icon" variant="ghost" aria-label="Modifier les besoins" onClick={openNeeds}>
              <Settings2 size={18} />
            </Button>
          }
        >
          <div className={`need-summary ${result.covered ? "need-covered" : ""}`}>
            <Users size={23} />
            <div>
              <strong>
                {assigned.length}
                <span> / {need.total} agents</span>
              </strong>
              <div className="mini-progress">
                <i style={{ width: `${Math.min(100, (assigned.length / need.total) * 100)}%` }} />
              </div>
            </div>
          </div>
          <h3 className="qualifications-title">Qualifications requises</h3>
          <div className="qualification-list">
            {result.qualifications
              .filter(q => q.need > 0)
              .map(q => (
                <div key={q.name}>
                  <span className="qualification-symbol">
                    <ShieldCheck size={18} />
                  </span>
                  <span>
                    <strong>{q.name}</strong>
                    <small>Au moins {q.need}</small>
                  </span>
                  <b className={q.actual >= q.need ? "text-green" : "text-red"}>
                    {q.actual}/{q.need}
                  </b>
                  {q.actual >= q.need ? (
                    <Check size={17} className="text-green" />
                  ) : (
                    <CircleAlert size={17} className="text-red" />
                  )}
                </div>
              ))}
          </div>
          <div className={result.covered ? "success-note" : "warning"}>
            {result.covered ? <Check size={20} /> : <CircleAlert size={20} />}
            <span>
              {result.covered
                ? "Ce créneau peut être publié."
                : `${Math.max(0, need.total - assigned.length)} agent(s) et ${result.qualifications.filter(q => q.actual < q.need).length} qualification(s) à compléter.`}
            </span>
          </div>
          {result.invalid.length > 0 && (
            <p className="text-red small">
              {result.invalid.length} affectation(s) ne correspondent plus à une disponibilité validée.
            </p>
          )}
          <p className="small muted">
            Un agent peut satisfaire plusieurs minima de qualification. Il compte une seule fois dans l’effectif.
          </p>
          <Button className="full-width" disabled={!result.covered} onClick={() => setPublishOpen(true)}>
            <Send size={16} />
            Publier ce créneau
          </Button>
          <p className="save-caption">Le brouillon est enregistré à chaque modification.</p>
        </Panel>
      </div>
      <Panel title="Répartition des gardes" subtitle="Charge dans le brouillon du mois, pour guider vos choix.">
        <div className="workload-list">
          {state.agents.map(a => {
            const count = Object.entries(state.assignments).filter(
              ([k, ids]) => k.startsWith(campaignId + "/") && ids.includes(a.id),
            ).length;
            return (
              <div key={a.id}>
                <Avatar agent={a} />
                <span>{a.name}</span>
                <strong>
                  {count}
                  <small> créneaux</small>
                </strong>
              </div>
            );
          })}
        </div>
      </Panel>
      <Modal
        open={needsOpen}
        onOpenChange={setNeedsOpen}
        title="Besoins de ce créneau"
        description={`${dateLabel(date)} · ${shift === "DAY" ? "Jour" : "Nuit"}. Ces besoins s’appliquent uniquement à cette garde.`}
      >
        <label className="field">
          Effectif minimum
          <input
            aria-label="Effectif minimum"
            type="number"
            min={1}
            max={100}
            value={total}
            onChange={e => setTotal(Number(e.target.value))}
          />
        </label>
        {["Chef", "Conducteur PL", "SAP", "Équipier INC"].map(q => (
          <label key={q} className="field">
            {q}
            <input
              type="number"
              min={0}
              max={total}
              value={qualifications[q] ?? 0}
              onChange={e => setQualifications(v => ({ ...v, [q]: Number(e.target.value) }))}
            />
          </label>
        ))}
        <Button
          className="full-width"
          onClick={() => {
            if (run({ type: "requirement", campaignId, date, shift, total, qualifications })) setNeedsOpen(false);
          }}
        >
          Enregistrer les besoins
        </Button>
      </Modal>
      <Modal
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publier cette garde"
        description={`${dateLabel(date)} · ${shift === "DAY" ? "Jour" : "Nuit"} · ${hours(campaign, shift)}`}
      >
        <div className="publish-summary">
          <CalendarCheck2 size={35} />
          <h3>{assigned.length} agents affectés</h3>
          <p>
            Cette version sera visible dans le planning personnel des agents concernés. Les autres créneaux restent
            inchangés.
          </p>
        </div>
        <Button
          className="full-width"
          onClick={() => {
            if (run({ type: "publish", campaignId, date, shift })) setPublishOpen(false);
          }}
        >
          <Send size={17} />
          Confirmer la publication
        </Button>
      </Modal>
    </>
  );
}
