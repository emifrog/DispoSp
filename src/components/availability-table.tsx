"use client";
import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownUp, Download, Search } from "lucide-react";
import { useApp } from "./provider";
import { Avatar, Legend, PageTitle, StatusBadge } from "./common";
import { Button } from "./ui/button";
import { availabilityCsv, download } from "@/lib/exports";
import { type Agent, dateLabel, entryKey, isValidated, monthDays, monthLabel } from "@/lib/domain";
export function AvailabilityTable() {
  const { state, campaignId } = useApp();
  const campaign = state.campaigns.find(c => c.id === campaignId)!;
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
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
  return (
    <>
      <PageTitle
        eyebrow="SYNTHÈSE D’ÉQUIPE"
        title="Toutes les disponibilités"
        description={`${monthLabel(campaign.month)} · Une vision partagée pour préparer chaque garde.`}
        action={
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
        <span className="muted small">{data.length} agent(s)</span>
      </div>
      <section className="panel table-panel">
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Tableau des disponibilités, défilement horizontal"
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
              {table.getRowModel().rows.map(row => (
                <tr key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
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
        <div className="panel-footnote">
          Totaux des agents affichés, réponses validées et brouillons inclus. Les 24 h sont comptées dans leur propre
          catégorie.
        </div>
      </section>
    </>
  );
}
