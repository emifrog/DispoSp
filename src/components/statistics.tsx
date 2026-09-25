"use client";
import { useState } from "react";
import { CircleAlert, Moon, Sun, TrendingUp } from "lucide-react";
import { useApp } from "./provider";
import { AdministrationOnly, Avatar, PageTitle, Panel, ProgressRing, SegmentedTabs } from "./common";
import {
  campaignAgents,
  coverage,
  entryKey,
  isValidated,
  labels,
  LOADED_MONTHS,
  localDate,
  monthDays,
  monthLabel,
  plural,
  responseKey,
  shiftKey,
  weekdayNames,
  withdrawnFrom,
  type AppState,
  type Availability,
  type Shift,
} from "@/lib/domain";

const SHIFTS: Shift[] = ["DAY", "NIGHT"];
const TYPES = Object.keys(labels) as Availability[];
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/**
 * Ce que les mois écoulés disent du centre.
 *
 * Tout est déjà en mémoire : l'état porte les saisies, les besoins et les
 * publications des campagnes des LOADED_MONTHS derniers mois, pas seulement de
 * celle qu'on regarde. Cet écran ne fait donc aucune requête de plus — il
 * relit ce que les autres écrans montrent un mois à la fois. Les archives, plus
 * anciennes, n'y entrent pas.
 *
 * Une réserve, et elle vaut pour tout ce qui suit : les taux se calculent sur
 * l'effectif d'aujourd'hui. Un agent parti ne compte plus dans les mois où il
 * répondait, un agent arrivé compte dans ceux qu'il n'a pas connus.
 */
export function Statistics() {
  const { state, campaignId, campaign, canAdminister } = useApp();
  const [view, setView] = useState<"months" | "weekdays" | "agents">("months");
  if (!canAdminister) return <AdministrationOnly title="Statistiques" />;

  return (
    <>
      <PageTitle
        title="Statistiques"
        description="Réponses, couverture et engagement, sur la durée plutôt que sur un mois."
      />
      <div className="info-card horizontal">
        <CircleAlert size={22} />
        <p>
          Les taux se calculent sur l’effectif actuel du centre. Un agent qui l’a quitté ne compte plus dans les mois où
          il répondait, et un agent arrivé depuis compte dans ceux qu’il n’a pas connus.
        </p>
      </div>
      <SegmentedTabs
        size="lg"
        label="Angle d’analyse"
        value={view}
        onChange={setView}
        options={[
          { value: "months", label: "Mois par mois", icon: TrendingUp },
          { value: "weekdays", label: "Jours de la semaine", icon: Sun },
          { value: "agents", label: "Par agent", icon: Moon },
        ]}
      />
      {view === "months" && <ByMonth state={state} />}
      {view === "weekdays" && <ByWeekday state={state} campaignId={campaignId} month={campaign.month} />}
      {view === "agents" && <ByAgent state={state} campaignId={campaignId} />}
    </>
  );
}

/** Une ligne par campagne : qui a répondu, et ce que ça a couvert. */
function ByMonth({ state }: { state: AppState }) {
  // Les archives n'ont pas leur détail chargé : les compter mettrait des zéros
  // là où il y a eu des réponses.
  const rows = state.campaigns
    .filter(c => !c.archived)
    .map(c => {
      const days = monthDays(c.month);
      // Chaque campagne a son propre périmètre : comparer des mois ouverts à des
      // équipes différentes sur l'effectif du centre rendait la colonne illisible.
      const concerned = campaignAgents(state, c.id);
      const validated = concerned.filter(a => state.responses[responseKey(c.id, a.id)]).length;
      const slots = days.flatMap(date => SHIFTS.map(shift => coverage(state, c.id, date, shift, "potential")));
      const measured = slots.filter(s => s.defined);
      const covered = measured.filter(s => s.covered).length;
      const published = days.flatMap(date =>
        SHIFTS.filter(shift => state.publications[shiftKey(c.id, date, shift)]),
      ).length;
      return {
        id: c.id,
        name: c.name,
        month: c.month,
        response: pct(validated, concerned.length),
        concerned: concerned.length,
        coverage: measured.length ? pct(covered, measured.length) : null,
        measured: measured.length,
        published,
        slots: days.length * 2,
      };
    });
  const average = rows.length ? Math.round(rows.reduce((t, r) => t + r.response, 0) / rows.length) : 0;

  return (
    <>
      <div className="stats-highlight">
        <ProgressRing percent={average} caption="de réponses" />
        <div className="stats-highlight-body">
          <strong>
            {rows.length} {plural(rows.length, "campagne")} sur {LOADED_MONTHS} mois
          </strong>
          <p className="muted">
            Taux de réponse moyen sur les campagnes des {LOADED_MONTHS} derniers mois, calculé sur les réponses
            explicitement validées. Les campagnes plus anciennes restent consultables une à une depuis le sélecteur.
          </p>
        </div>
      </div>
      <Panel title="Mois par mois" subtitle="Réponses validées, couverture potentielle et créneaux publiés.">
        <div className="needs-table-scroll">
          <table className="needs-table stats-table">
            <thead>
              <tr>
                <th>Campagne</th>
                <th>Réponses</th>
                <th>Couverture potentielle</th>
                <th>Publiés</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <th scope="row">
                    <strong>{r.name}</strong>
                    <small>{monthLabel(r.month)}</small>
                  </th>
                  <td>
                    <Bar
                      percent={r.response}
                      label={`${r.response} % · ${r.concerned} ${plural(r.concerned, "agent")}`}
                      tone="blue"
                    />
                  </td>
                  <td>
                    {r.coverage === null ? (
                      <span className="muted small">Aucun besoin défini</span>
                    ) : (
                      <Bar
                        percent={r.coverage}
                        label={`${r.coverage} % · ${r.measured} ${plural(r.measured, "créneau", "créneaux")}`}
                        tone="green"
                      />
                    )}
                  </td>
                  <td>
                    <span className="muted small">
                      {r.published} / {r.slots}
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-small">Aucune campagne enregistrée.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/**
 * Le mois vu par jour de semaine.
 *
 * C'est l'angle qui révèle les trous structurels : ce n'est pas « le 18 » qui
 * manque de monde, c'est le samedi soir, tous les samedis soirs.
 */
function ByWeekday({ state, campaignId, month }: { state: AppState; campaignId: string; month: string }) {
  const days = monthDays(month);
  const concerned = campaignAgents(state, campaignId);
  const rows = weekdayNames.map((name, index) => {
    const weekday = index + 1;
    const dates = days.filter(d => ((new Date(`${d}T12:00:00`).getDay() + 6) % 7) + 1 === weekday);
    const counts = Object.fromEntries(TYPES.map(t => [t, 0])) as Record<Availability, number>;
    let unfilled = 0;
    for (const date of dates)
      for (const agent of concerned) {
        const entry = state.entries[entryKey(campaignId, agent.id, date)];
        if (entry) counts[entry.type] += 1;
        else unfilled += 1;
      }
    const slots = dates.flatMap(date => SHIFTS.map(shift => coverage(state, campaignId, date, shift, "potential")));
    const measured = slots.filter(s => s.defined);
    return {
      name,
      dates: dates.length,
      counts,
      unfilled,
      total: dates.length * concerned.length,
      coverage: measured.length ? pct(measured.filter(s => s.covered).length, measured.length) : null,
    };
  });

  return (
    <Panel
      title={`Par jour de semaine · ${monthLabel(month)}`}
      subtitle="Ce qui manque un samedi manque tous les samedis : c’est ici que les trous réguliers se voient."
    >
      <div className="weekday-stats">
        {rows.map(r => (
          <div key={r.name}>
            <span className="weekday-stats-name">
              <strong>{r.name}</strong>
              <small>
                {r.dates} {plural(r.dates, "journée")}
              </small>
            </span>
            {/* Une barre empilée plutôt que cinq nombres : la proportion se lit
                d'un coup d'œil, et c'est la proportion qui compte ici. */}
            <span className="stacked-bar" role="img" aria-label={ariaFor(r.name, r.counts, r.unfilled, r.total)}>
              {TYPES.map(type =>
                r.counts[type] > 0 ? (
                  <i
                    key={type}
                    className={labels[type].className}
                    style={{ width: `${pct(r.counts[type], r.total)}%` }}
                    title={`${labels[type].label} : ${r.counts[type]}`}
                  />
                ) : null,
              )}
              {r.unfilled > 0 && (
                <i
                  className="unknown"
                  style={{ width: `${pct(r.unfilled, r.total)}%` }}
                  title={`Non renseigné : ${r.unfilled}`}
                />
              )}
            </span>
            <span className="weekday-stats-coverage">
              {r.coverage === null ? <small className="muted">—</small> : <strong>{r.coverage} %</strong>}
              <small>couverture potentielle</small>
            </span>
          </div>
        ))}
      </div>
      <div className="panel-footnote">
        Réponses validées et brouillons confondus. La couverture ne porte que sur les créneaux dont les besoins sont
        enregistrés.
      </div>
    </Panel>
  );
}

function ariaFor(name: string, counts: Record<Availability, number>, unfilled: number, total: number) {
  const parts = TYPES.filter(t => counts[t] > 0).map(t => `${labels[t].label} ${pct(counts[t], total)} %`);
  if (unfilled > 0) parts.push(`non renseigné ${pct(unfilled, total)} %`);
  return `${name} : ${parts.join(", ") || "aucune saisie"}`;
}

/** Ce que chaque agent a saisi et effectué, sur la campagne et sur la durée. */
function ByAgent({ state, campaignId }: { state: AppState; campaignId: string }) {
  const days = monthDays(state.campaigns.find(c => c.id === campaignId)?.month ?? "");
  const today = localDate();
  // La saisie du mois ne concerne que les participants ; les gardes, elles, se
  // comptent sur toutes les campagnes, donc sur tout l'effectif.
  const rows = campaignAgents(state, campaignId)
    .map(agent => {
      const filled = days.filter(d => state.entries[entryKey(campaignId, agent.id, d)]).length;
      // Les gardes effectuées se comptent sur toutes les campagnes de la
      // fenêtre, pas sur le seul mois affiché : c'est l'engagement dans la
      // durée qui se lit ici. Une archive chargée à la demande n'y entre pas,
      // sans quoi le total changerait selon ce qu'on vient de consulter.
      //
      // Effectuées : passées, et tenues. Les gardes publiées à venir s'y
      // comptaient, et un désistement accepté aussi, tant que la garde n'était
      // pas republiée sans l'agent.
      const shifts = state.campaigns
        .filter(c => !c.archived)
        .reduce(
          (total, c) =>
            total +
            monthDays(c.month)
              .filter(date => date < today)
              .flatMap(date =>
                SHIFTS.filter(
                  shift =>
                    state.publications[shiftKey(c.id, date, shift)]?.agents.includes(agent.id) &&
                    !withdrawnFrom(state, c.id, date, shift).has(agent.id),
                ),
              ).length,
          0,
        );
      return { agent, filled, shifts, validated: isValidated(state, campaignId, agent.id) };
    })
    .sort((a, b) => b.shifts - a.shifts || a.agent.name.localeCompare(b.agent.name, "fr"));
  const busiest = rows[0]?.shifts ?? 0;

  return (
    <Panel
      title="Par agent"
      subtitle={`Saisie du mois affiché, gardes effectuées sur les ${LOADED_MONTHS} derniers mois.`}
      action={
        <span className="pill pill-gray">
          {rows.length} {plural(rows.length, "agent")}
        </span>
      }
    >
      <div className="needs-table-scroll">
        <table className="needs-table stats-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Saisie du mois</th>
              <th>Réponse</th>
              <th>Gardes effectuées</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ agent, filled, shifts, validated }) => (
              <tr key={agent.id}>
                <th scope="row">
                  <span className="table-agent">
                    <Avatar agent={agent} />
                    <span>
                      <strong>{agent.name}</strong>
                      <small>{agent.team}</small>
                    </span>
                  </span>
                </th>
                <td>
                  <Bar
                    percent={pct(filled, days.length)}
                    label={`${filled} / ${days.length}`}
                    tone={filled === days.length ? "green" : "blue"}
                  />
                </td>
                <td>
                  <span className={`pill ${validated ? "pill-green" : "pill-orange"}`}>
                    {validated ? "Validée" : "À valider"}
                  </span>
                </td>
                <td>
                  <Bar percent={busiest ? pct(shifts, busiest) : 0} label={`${shifts}`} tone="blue" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-footnote">
        La barre des gardes est relative à l’agent le plus engagé du centre, pas à un objectif : elle compare, elle ne
        juge pas.
      </div>
    </Panel>
  );
}

function Bar({ percent, label, tone }: { percent: number; label: string; tone: "blue" | "green" }) {
  return (
    <span className="stat-bar">
      <span className={`stat-bar-track ${tone}`}>
        <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </span>
      <small>{label}</small>
    </span>
  );
}
