"use client";
import { useState } from "react";
import Link from "next/link";
import { CircleAlert, Copy, Moon, ShieldCheck, Sun, Wand2 } from "lucide-react";
import { useApp } from "./provider";
import { AdministrationOnly, PageTitle, Panel, SegmentedTabs } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import {
  dateLabel,
  hours,
  monthDays,
  monthLabel,
  plural,
  requirement,
  suggestedRequirement,
  weekdayNames,
  type Requirement,
  type Shift,
} from "@/lib/domain";
const SHIFTS: Shift[] = ["DAY", "NIGHT"];
const shiftLabel = (shift: Shift) => (shift === "DAY" ? "Jour" : "Nuit");

/**
 * Les besoins du mois, sur un écran.
 *
 * Le planning permet déjà de régler une garde à la fois : c'est ce qu'on fait
 * en cours de mois, pour une journée qui sort de l'ordinaire. Ici c'est
 * l'inverse — on pose la règle du mois d'un geste, puis le planning corrige les
 * exceptions. Les deux écrivent la même table.
 */
export function Needs() {
  const { state, campaignId, campaign, canAdminister, run } = useApp();
  const [open, setOpen] = useState(false);
  if (!canAdminister) return <AdministrationOnly title="Besoins du mois" />;
  const days = monthDays(campaign.month);
  const missing = days.flatMap(date => SHIFTS.filter(s => !requirement(state, campaignId, date, s))).length;

  return (
    <>
      <PageTitle
        title="Besoins du mois"
        description={`${monthLabel(campaign.month)} · effectifs et qualifications attendus, garde par garde.`}
        action={
          <Button onClick={() => setOpen(true)}>
            <Wand2 size={17} />
            Appliquer à plusieurs journées
          </Button>
        }
      />

      {missing > 0 && (
        <div className="warning">
          <CircleAlert size={19} />
          {missing} {plural(missing, "créneau", "créneaux")} sans besoin défini. Un créneau sans besoin n’est ni couvert
          ni en déficit, et la base refuse de le publier.
        </div>
      )}

      <Panel
        title="Le mois, journée par journée"
        subtitle="Un créneau mène au planning de cette garde, où il se règle seul. « Appliquer à plusieurs journées » pose la même règle partout."
      >
        <div className="needs-table-scroll">
          <table className="needs-table">
            <thead>
              <tr>
                <th>Journée</th>
                {SHIFTS.map(shift => (
                  <th key={shift}>
                    {shift === "DAY" ? <Sun size={15} /> : <Moon size={15} />}
                    {shiftLabel(shift)}
                    <small>{hours(campaign, shift)}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map(date => (
                <tr key={date}>
                  <th scope="row">
                    <strong>{dateLabel(date, { weekday: "short", day: "numeric" })}</strong>
                  </th>
                  {SHIFTS.map(shift => {
                    const need = requirement(state, campaignId, date, shift);
                    return (
                      <td key={shift}>
                        <NeedCell campaignId={campaignId} date={date} shift={shift} need={need} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-footnote">
          <ShieldCheck size={14} />
          Un agent peut satisfaire plusieurs minima de qualification. Il ne compte qu’une fois dans l’effectif.
        </div>
      </Panel>

      {open && (
        <BulkDialog
          campaignId={campaignId}
          days={days}
          catalogue={state.qualificationCatalogue}
          onClose={() => setOpen(false)}
          run={run}
        />
      )}
    </>
  );
}

function NeedCell({
  campaignId,
  date,
  shift,
  need,
}: {
  campaignId: string;
  date: string;
  shift: Shift;
  need: Requirement | null;
}) {
  const label = `${dateLabel(date, { weekday: "long", day: "numeric", month: "long" })}, ${shiftLabel(shift).toLowerCase()}`;
  // Le réglage d'un créneau seul vit déjà dans le planning, à côté des agents
  // qu'il concerne. Le dupliquer ici donnerait deux formulaires pour une même
  // ligne de table ; la cellule y mène plutôt qu'elle ne le refait.
  const href = `/planning?date=${date}&shift=${shift}`;
  if (!need)
    return (
      <Link className="need-cell empty" href={href} aria-label={`${label} : aucun besoin défini, à régler`}>
        —
      </Link>
    );
  const minima = Object.entries(need.qualifications).filter(([, count]) => count > 0);
  return (
    <Link className="need-cell" href={href} aria-label={`${label} : ${need.total} agents attendus`}>
      <strong>{need.total}</strong>
      {minima.length > 0 && <small>{minima.map(([name, count]) => `${count} ${name}`).join(" · ")}</small>}
    </Link>
  );
}

/** Poser la même règle sur une sélection de journées. */
function BulkDialog({
  campaignId,
  days,
  catalogue,
  onClose,
  run,
}: {
  campaignId: string;
  days: string[];
  catalogue: string[];
  onClose: () => void;
  run: ReturnType<typeof useApp>["run"];
}) {
  const [scope, setScope] = useState<"all" | "weekdays">("all");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [shifts, setShifts] = useState<Shift[]>(["DAY", "NIGHT"]);
  const [total, setTotal] = useState(suggestedRequirement.total);
  const [minima, setMinima] = useState<Record<string, number>>({ ...suggestedRequirement.qualifications });
  const offered = [...new Set([...catalogue, ...Object.keys(minima)])].sort((a, b) => a.localeCompare(b, "fr"));

  const chosen =
    scope === "all" || !weekdays.length
      ? days
      : days.filter(d => weekdays.includes(((new Date(`${d}T12:00:00`).getDay() + 6) % 7) + 1));
  // Le total doit pouvoir accueillir les minima : la base le vérifie aussi, mais
  // l'apprendre après 62 écritures serait désagréable.
  const required = Object.values(minima).reduce((a, b) => Math.max(a, b), 0);
  const impossible = total < required;

  return (
    <Modal
      open
      onOpenChange={next => !next && onClose()}
      title="Appliquer à plusieurs journées"
      description="Le même effectif et les mêmes minima sur toutes les journées retenues. Les besoins déjà enregistrés sont remplacés."
    >
      <SegmentedTabs
        size="lg"
        label="Journées concernées"
        value={scope}
        onChange={next => {
          setScope(next);
          if (next === "all") setWeekdays([]);
        }}
        options={[
          { value: "all", label: "Tout le mois" },
          { value: "weekdays", label: "Certains jours" },
        ]}
      />
      {scope === "weekdays" && (
        <>
          <span className="field-label">Jours de la semaine retenus</span>
          <div className="weekday-picker">
            {weekdayNames.map((name, index) => {
              const day = index + 1;
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={weekdays.includes(day)}
                  aria-label={name}
                  className={weekdays.includes(day) ? "selected" : ""}
                  onClick={() => setWeekdays(w => (w.includes(day) ? w.filter(d => d !== day) : [...w, day]))}
                >
                  {name[0].toUpperCase()}
                </button>
              );
            })}
          </div>
        </>
      )}

      <span className="field-label">Créneaux concernés</span>
      <div className="weekday-picker">
        {SHIFTS.map(shift => (
          <button
            key={shift}
            type="button"
            aria-pressed={shifts.includes(shift)}
            className={shifts.includes(shift) ? "selected" : ""}
            onClick={() => setShifts(s => (s.includes(shift) ? s.filter(x => x !== shift) : [...s, shift]))}
          >
            {shiftLabel(shift)}
          </button>
        ))}
      </div>

      <label className="field">
        Effectif attendu
        <input
          type="number"
          min={1}
          max={100}
          value={total}
          onChange={e => setTotal(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
        />
      </label>

      <fieldset className="field">
        <legend>Minima par qualification</legend>
        <div className="minima-grid">
          {offered.map(name => (
            <label key={name}>
              <span>{name}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={minima[name] ?? 0}
                onChange={e => setMinima(m => ({ ...m, [name]: Math.max(0, Number(e.target.value) || 0) }))}
              />
            </label>
          ))}
          {!offered.length && <p className="muted small">Aucune qualification au catalogue du centre.</p>}
        </div>
      </fieldset>

      <div className="quick-summary">
        <Copy size={17} />
        <span>
          <strong>
            {chosen.length * shifts.length} {plural(chosen.length * shifts.length, "créneau", "créneaux")}{" "}
            {plural(chosen.length * shifts.length, "concerné")}
          </strong>
          <small>
            {chosen.length} {plural(chosen.length, "journée")} × {shifts.length}{" "}
            {plural(shifts.length, "créneau", "créneaux")}
          </small>
        </span>
      </div>

      {impossible && (
        <div className="warning small">
          <CircleAlert size={18} />
          L’effectif attendu ne peut pas être inférieur au plus grand des minima ({required}).
        </div>
      )}

      <Button
        className="full-width"
        disabled={!chosen.length || !shifts.length || impossible}
        onClick={async () => {
          const ok = await run({
            type: "requirements",
            campaignId,
            dates: chosen,
            shifts,
            total,
            qualifications: minima,
          });
          if (ok) onClose();
        }}
      >
        <Wand2 size={17} />
        Appliquer
      </Button>
    </Modal>
  );
}
