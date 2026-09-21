"use client";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  Check,
  CircleAlert,
  Moon,
  Plus,
  Search,
  Send,
  Sun,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useApp } from "./provider";
import { PageTitle, Panel, Avatar, SegmentedTabs } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import {
  availableAgents,
  coverage,
  dateLabel,
  gradeLabel,
  grades,
  hours,
  monthDays,
  plural,
  requirement,
  shiftKey,
  suggestedRequirement,
  withdrawnFrom,
  workload,
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
  const [gradeFilter, setGradeFilter] = useState("");
  const [needsOpen, setNeedsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const date = days.includes(selectedDate) ? selectedDate : days[0];
  const key = shiftKey(campaignId, date, shift);
  // null until a requirement is recorded: the panel then says so instead of
  // showing a figure, and publication stays refused as the database refuses it.
  const need = requirement(state, campaignId, date, shift);
  const [total, setTotal] = useState((need ?? suggestedRequirement).total);
  const [qualifications, setQualifications] = useState<Record<string, number>>({
    ...(need ?? suggestedRequirement).qualifications,
  });
  const pool = availableAgents(state, campaignId, date, shift);
  const assignedIds = state.assignments[key] ?? [];
  const assigned = state.agents.filter(a => assignedIds.includes(a.id));
  // Les grades réellement présents dans le vivier, dans l'ordre hiérarchique de
  // la liste de saisie, suivis de ce qui n'y figure pas — une fiche ancienne
  // peut porter un grade hors catalogue, et elle ne doit pas disparaître.
  const gradeCounts = (() => {
    const counts = new Map<string, number>();
    for (const a of pool) if (a.grade) counts.set(a.grade, 1 + (counts.get(a.grade) ?? 0));
    const known = grades.filter(g => counts.has(g));
    const rest = [...counts.keys()].filter(g => !(grades as readonly string[]).includes(g)).sort();
    return [...known, ...rest].map(g => [g, counts.get(g) ?? 0] as const);
  })();
  const candidates = pool.filter(
    a =>
      !assignedIds.includes(a.id) &&
      (!gradeFilter || a.grade === gradeFilter) &&
      `${a.name} ${a.grade} ${a.fonction} ${a.qualifications.join(" ")}`
        .toLocaleLowerCase("fr")
        .includes(search.toLocaleLowerCase("fr")),
  );
  const result = coverage(state, campaignId, date, shift, "planned");
  const withdrawn = withdrawnFrom(state, campaignId, date, shift);
  const published = state.publications[key];
  const changed = published && JSON.stringify([...published.agents].sort()) !== JSON.stringify([...assignedIds].sort());
  function openNeeds() {
    setTotal((need ?? suggestedRequirement).total);
    setQualifications({ ...(need ?? suggestedRequirement).qualifications });
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
            {gradeLabel(agent)} · {agent.team.replace("Équipe ", "")}
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
        title="Construire le planning"
        description="Affectation des agents disponibles, créneau par créneau, puis publication."
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
        <SegmentedTabs
          label="Créneau de la garde"
          value={shift}
          onChange={setShift}
          options={[
            { value: "DAY", label: "Jour", icon: Sun },
            { value: "NIGHT", label: "Nuit", icon: Moon },
          ]}
        />
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
              placeholder="Nom, grade, fonction, qualification…"
              aria-label="Rechercher un agent disponible"
            />
          </label>
          {/* Les puces de la maquette. Elles ne listent que les grades présents
              dans le vivier du jour, avec leur effectif : une puce « Lieutenant
              0 » ne rendrait service à personne. */}
          <div className="grade-chips" role="group" aria-label="Filtrer par grade">
            <button
              type="button"
              aria-pressed={!gradeFilter}
              className={!gradeFilter ? "selected" : ""}
              onClick={() => setGradeFilter("")}
            >
              Tous <b>{pool.length}</b>
            </button>
            {gradeCounts.map(([grade, count]) => (
              <button
                key={grade}
                type="button"
                aria-pressed={gradeFilter === grade}
                className={gradeFilter === grade ? "selected" : ""}
                onClick={() => setGradeFilter(g => (g === grade ? "" : grade))}
              >
                {grade} <b>{count}</b>
              </button>
            ))}
          </div>
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
              {assigned.length} / {need ? need.total : "—"}
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
          {need ? (
            <>
              <div className={`need-summary ${result.covered ? "need-covered" : ""}`}>
                <Users size={23} />
                <div>
                  <strong>
                    {assigned.length}
                    <span>
                      {" "}
                      / {need.total} {plural(need.total, "agent")}
                    </span>
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
                    : `${Math.max(0, need.total - assigned.length)} ${plural(Math.max(0, need.total - assigned.length), "agent")} et ${result.qualifications.filter(q => q.actual < q.need).length} ${plural(result.qualifications.filter(q => q.actual < q.need).length, "qualification")} à compléter.`}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="warning">
                <CircleAlert size={20} />
                <span>
                  <strong>Besoins non définis.</strong> Tant qu’aucun effectif n’est enregistré pour cette garde, la
                  couverture ne peut pas être mesurée et la publication est refusée.
                </span>
              </div>
              <Button variant="secondary" className="full-width" onClick={openNeeds}>
                <Settings2 size={16} />
                Définir les besoins
              </Button>
            </>
          )}
          {/* Deux causes, deux remèdes : l'une se règle avec l'agent, l'autre
              a déjà été tranchée et demande un remplaçant. Les confondre
              enverrait chercher au mauvais endroit. */}
          {withdrawn.size > 0 && (
            <p className="text-red small">
              {withdrawn.size} {plural(withdrawn.size, "agent")} {plural(withdrawn.size, "s’est", "se sont")} désisté
              {withdrawn.size > 1 ? "s" : ""} de cette garde, et {plural(withdrawn.size, "sa", "leur")} demande a été
              acceptée. Retirez-{plural(withdrawn.size, "le", "les")} et trouvez un remplaçant : la publication refuse.
            </p>
          )}
          {result.invalid.filter(a => !withdrawn.has(a.id)).length > 0 && (
            <p className="text-red small">
              {result.invalid.filter(a => !withdrawn.has(a.id)).length}{" "}
              {plural(result.invalid.filter(a => !withdrawn.has(a.id)).length, "affectation")}{" "}
              {plural(result.invalid.filter(a => !withdrawn.has(a.id)).length, "ne correspond", "ne correspondent")}{" "}
              plus à une disponibilité validée.
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
      <Panel
        title="Répartition des gardes"
        subtitle="Charge par agent dans le brouillon du mois."
        action={
          <span className="muted small">24 h = les deux créneaux d’une même date · le total compte les créneaux</span>
        }
      >
        <div className="equity-table-scroll">
          <table className="equity-table">
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Jour</th>
                <th scope="col">Nuit</th>
                <th scope="col">24 h</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {state.agents
                .map(a => ({ agent: a, load: workload(state, campaignId, a.id) }))
                .sort((x, y) => y.load.total - x.load.total || x.agent.name.localeCompare(y.agent.name, "fr"))
                .map(({ agent, load }) => (
                  <tr key={agent.id}>
                    <th scope="row">
                      <Avatar agent={agent} />
                      {agent.name}
                    </th>
                    <td className={load.day ? "" : "nil"}>{load.day}</td>
                    <td className={load.night ? "" : "nil"}>{load.night}</td>
                    <td className={load.full ? "" : "nil"}>{load.full}</td>
                    <td>
                      <strong>{load.total}</strong>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
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
          onClick={async () => {
            if (await run({ type: "requirement", campaignId, date, shift, total, qualifications })) setNeedsOpen(false);
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
          <h3>
            {assigned.length} {plural(assigned.length, "agent")} {plural(assigned.length, "affecté")}
          </h3>
          <p>
            Cette version sera visible dans le planning personnel des agents concernés. Les autres créneaux restent
            inchangés.
          </p>
        </div>
        <Button
          className="full-width"
          onClick={async () => {
            if (await run({ type: "publish", campaignId, date, shift })) setPublishOpen(false);
          }}
        >
          <Send size={17} />
          Confirmer la publication
        </Button>
      </Modal>
    </>
  );
}
