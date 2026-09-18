"use client";
import { useState } from "react";
import { CalendarDays, Check, CheckCheck, CircleAlert, Clock3, Moon, Sun, X, Zap } from "lucide-react";
import { useApp } from "./provider";
import { PageTitle, Panel, Legend } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import {
  entryKey,
  filledDays,
  hours,
  isOpen,
  isValidated,
  labels,
  monthDays,
  monthLabel,
  dateLabel,
  type Availability as AvailabilityType,
} from "@/lib/domain";
export function Availability() {
  const { state, actor, campaignId, run } = useApp();
  const campaign = state.campaigns.find(c => c.id === campaignId)!;
  const days = monthDays(campaign.month);
  const filled = filledDays(state, campaign, actor.id);
  const validated = isValidated(state, campaignId, actor.id);
  const open = isOpen(campaign);
  const [selected, setSelected] = useState<string[]>([]);
  const [multiple, setMultiple] = useState(false);
  const [editing, setEditing] = useState(false);
  const [quick, setQuick] = useState(false);
  const [value, setValue] = useState<AvailabilityType | null>("DAY");
  const [comment, setComment] = useState("");
  const [start, setStart] = useState(days[0]);
  const [end, setEnd] = useState(days[days.length - 1]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const leading = (new Date(`${days[0]}T12:00:00`).getDay() + 6) % 7;
  const chosen = quick
    ? days.filter(
        d => d >= start && d <= end && (!weekdays.length || weekdays.includes(new Date(`${d}T12:00`).getDay())),
      )
    : selected.filter(d => days.includes(d));
  const overwritten = chosen.filter(d => state.entries[entryKey(campaignId, actor.id, d)]).length;
  const icons = { DAY: Sun, NIGHT: Moon, FULL_24H: Clock3, UNAVAILABLE: X };
  function save() {
    if (run({ type: "availability", campaignId, dates: chosen, value, comment })) {
      setEditing(false);
      setQuick(false);
      setSelected([]);
    }
  }
  function selectDay(date: string) {
    if (multiple) setSelected(s => (s.includes(date) ? s.filter(d => d !== date) : [...s, date]));
    else {
      const entry = state.entries[entryKey(campaignId, actor.id, date)];
      setSelected([date]);
      setValue(entry?.type ?? "DAY");
      setComment(entry?.comment ?? "");
      setEditing(true);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ESPACE AGENT"
        title="Mes disponibilités"
        description="Quelques gestes pour préparer le mois. Chaque présence compte."
        action={
          <Button
            disabled={!open}
            onClick={() => {
              setQuick(true);
              setValue("DAY");
              setComment("");
              setStart(days[0]);
              setEnd(days[days.length - 1]);
            }}
          >
            <Zap size={17} />
            Saisie rapide
          </Button>
        }
      />
      <div className={`response-banner ${validated ? "validated" : ""}`}>
        <span className="response-banner-icon">{validated ? <CheckCheck /> : <CalendarDays />}</span>
        <div>
          <strong>{validated ? "Votre réponse est validée" : `${filled} / ${days.length} jours renseignés`}</strong>
          <p>
            {validated
              ? "Toute modification nécessitera une nouvelle validation."
              : `Renseignez votre mois, puis validez explicitement votre réponse avant le ${dateLabel(campaign.closesOn)}.`}
          </p>
        </div>
        <span className={`pill ${validated ? "pill-green" : "pill-orange"}`}>
          {validated ? "Validée" : "À valider"}
        </span>
      </div>
      {!open && (
        <div className="warning">
          <CircleAlert size={19} />
          Cette campagne est clôturée. Vos disponibilités restent consultables.
        </div>
      )}
      <div className="availability-layout">
        <Panel
          title={monthLabel(campaign.month)}
          subtitle={`${hours(campaign, "DAY")} · ${hours(campaign, "NIGHT")}`}
          action={
            <Button
              variant="secondary"
              size="sm"
              disabled={!open}
              onClick={() => {
                setMultiple(v => !v);
                setSelected([]);
              }}
            >
              {multiple ? "Terminer la sélection" : "Sélection multiple"}
            </Button>
          }
        >
          <div className="month-calendar">
            {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(d => (
              <span className="weekday" key={d}>
                {d}
              </span>
            ))}
            {Array.from({ length: leading }, (_, i) => (
              <span className="calendar-spacer" key={`empty-${i}`} />
            ))}
            {days.map(d => {
              const entry = state.entries[entryKey(campaignId, actor.id, d)];
              const Icon = entry ? icons[entry.type] : null;
              return (
                <button
                  key={d}
                  disabled={!open}
                  aria-label={`${dateLabel(d)}, ${entry ? labels[entry.type].label : "Non renseigné"}`}
                  aria-pressed={selected.includes(d)}
                  onClick={() => selectDay(d)}
                  className={`calendar-day ${entry ? labels[entry.type].className : "unknown"} ${selected.includes(d) ? "is-selected" : ""}`}
                >
                  <span className="day-number">{Number(d.slice(-2))}</span>
                  {Icon ? <Icon size={17} /> : <span className="unknown-symbol">?</span>}
                  <strong>{entry ? labels[entry.type].short : "—"}</strong>
                  {entry?.comment && <i className="comment-dot" title={entry.comment} />}
                </button>
              );
            })}
          </div>
          <Legend />
          {multiple && (
            <div className="selection-bar">
              <span>{selected.length} jour(s) sélectionné(s)</span>
              <Button
                size="sm"
                disabled={!selected.length}
                onClick={() => {
                  setComment("");
                  setEditing(true);
                }}
              >
                Appliquer un statut
              </Button>
            </div>
          )}
        </Panel>
        <div className="availability-side">
          <Panel title="Prêt à transmettre ?" subtitle="La saisie ne vaut pas validation.">
            <div className="completion-number">
              {Math.round((filled / days.length) * 100)}
              <span>%</span>
            </div>
            <div className="mini-progress">
              <i style={{ width: `${(filled / days.length) * 100}%` }} />
            </div>
            <p className="muted">
              {days.length - filled > 0
                ? `${days.length - filled} jours restent à renseigner. Pensez à indiquer vos indisponibilités.`
                : "Tous les jours sont renseignés. Vous pouvez valider votre réponse."}
            </p>
            <Button
              className="full-width"
              disabled={!open || filled !== days.length || validated}
              onClick={() => run({ type: "validate", campaignId })}
            >
              <CheckCheck size={18} />
              {validated ? "Réponse validée" : "Valider mes disponibilités"}
            </Button>
          </Panel>
          <div className="info-card">
            <Clock3 size={22} />
            <h3>Comment fonctionne le 24 h ?</h3>
            <p>
              Du jour sélectionné à {campaign.dayStart} h jusqu’au lendemain à {campaign.dayStart} h. Vous êtes
              disponible pour le Jour et la Nuit de cette date.
            </p>
            <p>La disponibilité ne vous affecte pas automatiquement au planning.</p>
          </div>
        </div>
      </div>
      <Modal
        open={editing || quick}
        onOpenChange={o => {
          if (!o) {
            setEditing(false);
            setQuick(false);
          }
        }}
        title={
          quick
            ? "Saisie rapide"
            : chosen.length === 1
              ? dateLabel(chosen[0], { weekday: "long", day: "numeric", month: "long" })
              : `${chosen.length} jours sélectionnés`
        }
        description="Choisissez une disponibilité. Elle sera enregistrée en brouillon jusqu’à votre validation."
      >
        {quick && (
          <>
            <div className="form-grid">
              <label>
                Du
                <input
                  type="date"
                  min={days[0]}
                  max={days[days.length - 1]}
                  value={start}
                  onChange={e => setStart(e.target.value)}
                />
              </label>
              <label>
                Au
                <input
                  type="date"
                  min={start}
                  max={days[days.length - 1]}
                  value={end}
                  onChange={e => setEnd(e.target.value)}
                />
              </label>
            </div>
            <span className="field-label">Filtrer par jour de semaine (facultatif)</span>
            <div className="weekday-picker">
              {[1, 2, 3, 4, 5, 6, 0].map((day, i) => (
                <button
                  key={day}
                  aria-pressed={weekdays.includes(day)}
                  className={weekdays.includes(day) ? "selected" : ""}
                  onClick={() => setWeekdays(w => (w.includes(day) ? w.filter(d => d !== day) : [...w, day]))}
                >
                  {["L", "M", "M", "J", "V", "S", "D"][i]}
                  <span className="sr-only">
                    {["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][i]}
                  </span>
                </button>
              ))}
            </div>
            <p className="muted">{chosen.length} jour(s) concerné(s)</p>
          </>
        )}
        <div className="availability-choices">
          {Object.entries(labels).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={value === key}
              className={`${label.className} ${value === key ? "chosen" : ""}`}
              onClick={() => setValue(key as AvailabilityType)}
            >
              <strong>{label.short}</strong>
              <span>{label.label}</span>
              {value === key && <Check size={14} />}
            </button>
          ))}
        </div>
        <button className="text-button" onClick={() => setValue(null)}>
          {value === null ? "✓ " : ""}Remettre à « Non renseigné »
        </button>
        <label className="field">
          Commentaire facultatif
          <textarea
            maxLength={500}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Une précision à transmettre au responsable…"
          />
        </label>
        {overwritten > 0 && (
          <div className="warning small">
            <CircleAlert size={18} />
            {overwritten} jour(s) déjà renseigné(s) seront remplacés.
          </div>
        )}
        <Button className="full-width" disabled={!chosen.length} onClick={save}>
          Enregistrer {chosen.length > 1 ? `les ${chosen.length} jours` : "la disponibilité"}
        </Button>
      </Modal>
    </>
  );
}
