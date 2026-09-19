"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Download,
  FileSpreadsheet,
  Printer,
  Search,
} from "lucide-react";
import { useApp } from "./provider";
import { Avatar, Legend, PageTitle, ProgressRing, SegmentedTabs, StatusBadge } from "./common";
import { Button } from "./ui/button";
import { availabilityCsv, download } from "@/lib/exports";
import { type Agent, dateLabel, entryKey, isValidated, localDate, monthDays, monthLabel, plural } from "@/lib/domain";
// Deux hauteurs parce qu'il y a deux densités. Le virtualiseur ne mesure pas les
// lignes, il les estime : une valeur fausse décalerait les cales de défilement
// et ferait sauter la matrice. Ces deux nombres doivent donc suivre le CSS de
// `.availability-table td` et de sa variante compacte.
const ROW_HEIGHT = 45;
const ROW_HEIGHT_COMPACT = 32;
export function AvailabilityTable() {
  const { state, campaignId, campaign } = useApp();
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  // §6 demande les deux : la matrice pour comparer, la journée pour appeler.
  const [view, setView] = useState<"matrix" | "day">("matrix");
  // La vue compacte resserre les lignes et retire les totaux : on y cherche un
  // agent dans une longue liste, pas un chiffre par journée.
  const [density, setDensity] = useState<"detailed" | "compact">("detailed");
  const days = useMemo(() => monthDays(campaign.month), [campaign.month]);
  const data = useMemo(
    () =>
      state.agents.filter(
        a =>
          a.name.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")) &&
          (!team || a.team === team) &&
          (!status || isValidated(state, campaignId, a.id) === (status === "validated")),
      ),
    [state, campaignId, search, team, status],
  );
  // L'avancement du centre : une case par agent affiché et par jour du mois.
  const cells = data.length * days.length;
  const entered = data.reduce(
    (total, a) => total + days.filter(d => state.entries[entryKey(campaignId, a.id, d)]).length,
    0,
  );
  const incomplete = data.filter(a => days.some(d => !state.entries[entryKey(campaignId, a.id, d)])).length;
  const columns = useMemo<ColumnDef<Agent>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Agent",
        cell: ({ row }) => (
          <div className="table-agent">
            <Avatar agent={row.original} />
            <span>
              <strong>{row.original.name}</strong>
              <small>{row.original.team}</small>
            </span>
          </div>
        ),
      },
      {
        id: "response",
        header: "Réponse",
        cell: ({ row }) => (
          <span
            className={`response-dot ${isValidated(state, campaignId, row.original.id) ? "responded" : "pending"}`}
            title={isValidated(state, campaignId, row.original.id) ? "Réponse validée" : "À valider"}
          >
            {isValidated(state, campaignId, row.original.id) ? "Validée" : "À valider"}
          </span>
        ),
      },
      ...days.map(d => ({
        id: d,
        header: () => (
          <span className="column-date">
            <small>{dateLabel(d, { weekday: "short" }).slice(0, 3)}</small>
            <b>{Number(d.slice(-2))}</b>
          </span>
        ),
        cell: ({ row }: { row: { original: Agent } }) => {
          const e = state.entries[entryKey(campaignId, row.original.id, d)];
          return (
            <span title={e?.comment || undefined}>
              <StatusBadge value={e?.type} />
            </span>
          );
        },
      })),
    ],
    [days, state, campaignId],
  );
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  // A centre with several hundred agents would otherwise paint agents × 33 cells
  // at once. Only the visible rows are rendered; two spacer rows hold the
  // scroll height. The footer totals still cover every filtered agent.
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (density === "compact" ? ROW_HEIGHT_COMPACT : ROW_HEIGHT),
    overscan: 10,
  });
  // Changer de densité change la hauteur des lignes : sans nouvelle mesure, le
  // virtualiseur garderait l'ancienne estimation et placerait les cales à côté.
  useEffect(() => virtualizer.measure(), [density, virtualizer]);
  const virtualRows = virtualizer.getVirtualItems();
  // Imprimer une matrice virtualisée ne sortait que les lignes à l'écran. Le
  // temps de l'impression, toutes les lignes sont rendues : flushSync parce que
  // le navigateur photographie la page dès que « beforeprint » lui rend la main,
  // et l'écouteur parce que Ctrl+P ne passe pas par notre bouton.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const open = () => flushSync(() => setPrinting(true));
    const close = () => setPrinting(false);
    window.addEventListener("beforeprint", open);
    window.addEventListener("afterprint", close);
    return () => {
      window.removeEventListener("beforeprint", open);
      window.removeEventListener("afterprint", close);
    };
  }, []);
  const printedRows = printing ? rows.map((_, index) => index) : virtualRows.map(item => item.index);
  const padding =
    printing || !virtualRows.length
      ? { top: 0, bottom: 0 }
      : {
          top: virtualRows[0].start,
          bottom: virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end,
        };
  return (
    <>
      <PageTitle
        title="Disponibilités du centre"
        description={`${monthLabel(campaign.month)} · saisies et validations de l’ensemble des agents.`}
        action={
          <div className="heading-buttons">
            {/* Excel passe par une route serveur : le classeur est construit là-bas,
              et la bibliothèque ne descend dans aucun paquet du navigateur. */}
            <Button asChild>
              <a href={`/api/export?campagne=${campaignId}`} download>
                <FileSpreadsheet size={17} />
                Exporter en Excel
              </a>
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                download(
                  availabilityCsv({ ...state, agents: data }, campaign),
                  `disponibilites-${campaign.month}.csv`,
                  "text/csv;charset=utf-8",
                )
              }
            >
              <Download size={17} />
              Exporter la vue CSV
            </Button>
            {view === "matrix" && (
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={17} />
                Imprimer le mois
              </Button>
            )}
          </div>
        }
      />
      <div className="table-filters">
        <label className="search-field">
          <Search size={17} />
          <input
            placeholder="Rechercher un agent…"
            aria-label="Rechercher un agent"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <select aria-label="Filtrer par équipe" value={team} onChange={e => setTeam(e.target.value)}>
          <option value="">Toutes les équipes</option>
          {[...new Set(state.agents.map(a => a.team))].map(t => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select aria-label="Filtrer par validation" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Toutes les réponses</option>
          <option value="validated">Réponses validées</option>
          <option value="pending">À valider</option>
        </select>
        <SegmentedTabs
          label="Forme de la synthèse"
          value={view}
          onChange={setView}
          options={[
            { value: "matrix", label: "Matrice" },
            { value: "day", label: "Par journée" },
          ]}
        />
        {view === "matrix" && (
          <SegmentedTabs
            label="Densité de la matrice"
            value={density}
            onChange={setDensity}
            options={[
              { value: "detailed", label: "Vue détaillée" },
              { value: "compact", label: "Vue compacte" },
            ]}
          />
        )}
        <span className="muted small">
          {data.length} {plural(data.length, "agent")}
        </span>
      </div>
      {/* Ce que la maquette met en tête d'écran : l'avancement du centre, pas
          celui d'un agent. Il suit les filtres — restreindre à une équipe
          restreint le taux. */}
      <div className="response-banner">
        <ProgressRing percent={cells ? (entered / cells) * 100 : 0} size="sm" />
        <div className="response-banner-body">
          <strong>
            {entered} / {cells} {plural(cells, "journée")} {plural(cells, "renseignée")}
          </strong>
          <div className="mini-progress">
            <i style={{ width: `${cells ? (entered / cells) * 100 : 0}%` }} />
          </div>
          <p>
            Sur {data.length} {plural(data.length, "agent")} {plural(data.length, "affiché")} et {days.length} jours du
            mois.
          </p>
        </div>
        {incomplete > 0 ? (
          <span className="pill pill-red">
            <CircleAlert size={14} />
            {incomplete} {plural(incomplete, "agent")} {plural(incomplete, "n’a", "n’ont")} pas fini
          </span>
        ) : (
          <span className="pill pill-green">Tous les mois sont complets</span>
        )}
      </div>
      {view === "day" && <DayView agents={data} days={days} campaignId={campaignId} />}
      {view === "matrix" && printing && (
        <style dangerouslySetInnerHTML={{ __html: "@page { size: A4 landscape; margin: 8mm }" }} />
      )}
      {view === "matrix" && (
        <section
          className={`panel table-panel${printing ? " printing" : ""}${density === "compact" ? " compact" : ""}`}
        >
          <div
            ref={scrollRef}
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Tableau des disponibilités, défilement horizontal et vertical"
          >
            <table className="availability-table">
              <thead>
                {table.getHeaderGroups().map(group => (
                  <tr key={group.id}>
                    {group.headers.map(header => (
                      <th key={header.id}>
                        {header.column.getCanSort() ? (
                          <button onClick={header.column.getToggleSortingHandler()}>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <ArrowDownUp size={13} />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {padding.top > 0 && (
                  <tr aria-hidden="true" className="virtual-spacer" style={{ height: padding.top }} />
                )}
                {printedRows.map(index => {
                  const row = rows[index];
                  return (
                    <tr key={row.id}>
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                      ))}
                    </tr>
                  );
                })}
                {padding.bottom > 0 && (
                  <tr aria-hidden="true" className="virtual-spacer" style={{ height: padding.bottom }} />
                )}
              </tbody>
              {/* Les totaux par journée sont l'objet même de la vue détaillée.
                  En compact on cherche une ligne, pas une colonne. */}
              <tfoot hidden={density === "compact"}>
                {(["DAY", "NIGHT", "FULL_24H", "UNAVAILABLE", "UNKNOWN"] as const).map(type => (
                  <tr key={type}>
                    <th colSpan={2}>
                      {type === "DAY"
                        ? "Jour"
                        : type === "NIGHT"
                          ? "Nuit"
                          : type === "FULL_24H"
                            ? "24 h"
                            : type === "UNAVAILABLE"
                              ? "Indisponible"
                              : "Non renseigné"}
                    </th>
                    {days.map(d => (
                      <td key={d}>
                        {
                          data.filter(a => (state.entries[entryKey(campaignId, a.id, d)]?.type ?? "UNKNOWN") === type)
                            .length
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tfoot>
            </table>
            {!data.length && <div className="empty-small">Aucun agent ne correspond aux filtres.</div>}
          </div>
          <Legend />
          {density === "detailed" && (
            <div className="panel-footnote">
              Totaux des agents affichés, réponses validées et brouillons inclus. Les 24 h sont comptées dans leur
              propre catégorie.
            </div>
          )}
        </section>
      )}
    </>
  );
}

// §6 : « puis les listes nominatives ». Les totaux disent qu'il manque du monde ;
// seules les listes disent qui appeler.
const DAY_GROUPS = [
  { type: "DAY", label: "Jour", className: "day" },
  { type: "NIGHT", label: "Nuit", className: "night" },
  { type: "FULL_24H", label: "24 h", className: "full" },
  { type: "UNAVAILABLE", label: "Indisponible", className: "unavailable" },
  { type: "UNKNOWN", label: "Non renseigné", className: "unknown" },
] as const;

function DayView({ agents, days, campaignId }: { agents: Agent[]; days: string[]; campaignId: string }) {
  const { state } = useApp();
  const today = localDate();
  const [date, setDate] = useState(() => (days.includes(today) ? today : days[0]));
  const selected = days.includes(date) ? date : days[0];
  const typeOf = (agent: Agent) => state.entries[entryKey(campaignId, agent.id, selected)]?.type ?? "UNKNOWN";
  // Répondre à la campagne et être disponible ce jour-là sont deux questions
  // distinctes : la seconde ne veut rien dire tant que la première est ouverte.
  const pending = agents.filter(a => !isValidated(state, campaignId, a.id));
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{dateLabel(selected, { weekday: "long", day: "numeric", month: "long" })}</h2>
          <p>Effectifs et listes nominatives de la journée.</p>
        </div>
        <Button variant="secondary" className="no-print" onClick={() => window.print()}>
          <Printer size={16} />
          Imprimer
        </Button>
        <div className="date-navigation">
          <Button
            size="icon"
            variant="secondary"
            aria-label="Jour précédent"
            disabled={selected === days[0]}
            onClick={() => setDate(days[days.indexOf(selected) - 1])}
          >
            <ArrowLeft size={17} />
          </Button>
          <label>
            <span className="sr-only">Date</span>
            <input
              aria-label="Date de la journée"
              type="date"
              min={days[0]}
              max={days[days.length - 1]}
              value={selected}
              onChange={e => setDate(e.target.value)}
            />
          </label>
          <Button
            size="icon"
            variant="secondary"
            aria-label="Jour suivant"
            disabled={selected === days[days.length - 1]}
            onClick={() => setDate(days[days.indexOf(selected) + 1])}
          >
            <ArrowRight size={17} />
          </Button>
        </div>
      </div>
      <div className="day-groups">
        {DAY_GROUPS.map(group => {
          const list = agents.filter(a => typeOf(a) === group.type);
          return (
            <article key={group.type} className={`day-group ${group.className}`}>
              <header>
                <span>{group.label}</span>
                <strong>{list.length}</strong>
              </header>
              {list.length ? (
                <ul>
                  {list.map(a => (
                    <li key={a.id}>
                      <Avatar agent={a} />
                      <span>
                        <strong>{a.name}</strong>
                        <small>{a.team}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Personne.</p>
              )}
            </article>
          );
        })}
        <article className="day-group pending">
          <header>
            <span>Réponse non validée</span>
            <strong>{pending.length}</strong>
          </header>
          {pending.length ? (
            <ul>
              {pending.map(a => (
                <li key={a.id}>
                  <Avatar agent={a} />
                  <span>
                    <strong>{a.name}</strong>
                    <small>{a.team}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Tout le monde a validé.</p>
          )}
        </article>
      </div>
      <div className="panel-footnote">
        Sur {agents.length} {plural(agents.length, "agent")} {plural(agents.length, "affiché")} par les filtres. Une
        réponse non validée n’alimente ni la couverture potentielle, ni la liste des agents affectables.
      </div>
    </section>
  );
}
