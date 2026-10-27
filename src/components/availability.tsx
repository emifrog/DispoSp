"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, CalendarRange, Check, CheckCheck, CircleAlert, Clock3, Moon, Sun, X, Zap } from "lucide-react";
import { useApp } from "./provider";
import { PageTitle, Panel, Legend, ProgressRing, SegmentedTabs } from "./common";
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
  plural,
  weekdayNames,
  type Availability,
  type Shift,
} from "@/lib/domain";

/** Le jour de semaine ISO d'une date, comme la base le compte : « 1 » = lundi, « 7 » = dimanche. */
const isoWeekday = (date: string) => String(((new Date(`${date}T12:00:00`).getDay() + 6) % 7) + 1);

/**
 * Les disponibilités de l'agent, pour la campagne choisie.
 *
 * Deux façons de saisir, pas davantage (revue d'ergonomie du 16 octobre, C4) :
 * toucher un jour du calendrier, ou la saisie rapide, qui couvre une période
 * d'une même valeur, ou y pose une semaine type. Il y en avait quatre — une
 * sélection multiple, et un panneau « Ma disponibilité habituelle » qu'il
 * fallait enregistrer avant de pouvoir l'appliquer, sans que le bouton grisé ne
 * dise pourquoi. La semaine habituelle se garde désormais en l'appliquant.
 */
export function Availability() {
  const { state, actor, campaignId, campaign, run } = useApp();
  const params = useSearchParams();
  const days = monthDays(campaign.month);
  const filled = filledDays(state, campaign, actor.id);
  const validated = isValidated(state, campaignId, actor.id);
  const open = isOpen(campaign);
  const isFilled = (date: string) => Boolean(state.entries[entryKey(campaignId, actor.id, date)]);
  // Le jour ouvert depuis le calendrier.
  const [day, setDay] = useState<string | null>(null);
  // L'accueil pointe ici avec ?saisie=rapide, ou ?saisie=semaine pour la semaine
  // type. L'initialiseur d'état suffit : il ne s'exécute qu'au montage, donc
  // refermer la boîte ne la rouvre pas. Sur une campagne fermée, non : le bouton
  // « Saisie rapide » y est éteint, et l'enregistrement serait refusé.
  const asked = params.get("saisie");
  const [quick, setQuick] = useState(() => open && (asked === "rapide" || asked === "semaine"));
  const [quickMode, setQuickMode] = useState<"period" | "week">(() => (asked === "semaine" ? "week" : "period"));
  // `undefined` : rien de choisi encore. `null` : « Non renseigné », choisi.
  // Un jour vide s'ouvrait sur « Jour » déjà coché : toucher « Enregistrer »
  // sans rien choisir enregistrait une disponibilité que l'agent n'avait pas
  // donnée (C4).
  const [value, setValue] = useState<Availability | null | undefined>(undefined);
  const [comment, setComment] = useState("");
  const [start, setStart] = useState(days[0]);
  const [end, setEnd] = useState(days[days.length - 1]);
  // Par défaut, la saisie rapide n'écrase rien : on complète, et l'on remplace
  // seulement si on le demande.
  const [keepFilled, setKeepFilled] = useState(true);
  // La semaine type part de la semaine habituelle enregistrée.
  const [week, setWeek] = useState<Record<string, Availability | undefined>>(() => ({ ...state.template }));
  const [remember, setRemember] = useState(true);
  const leading = (new Date(`${days[0]}T12:00:00`).getDay() + 6) % 7;
  const icons = { DAY: Sun, NIGHT: Moon, FULL_24H: Clock3, UNAVAILABLE: X };

  const inPeriod = days.filter(d => d >= start && d <= end);
  const filledInPeriod = inPeriod.filter(isFilled).length;
  // « Non renseigné » efface : il n'a rien à épargner.
  const spare = keepFilled && !(quickMode === "period" && value === null);
  const weekChosen = Object.values(week).some(Boolean);
  const targets = !quick
    ? day
      ? [day]
      : []
    : inPeriod.filter(d => (quickMode === "period" || week[isoWeekday(d)]) && !(spare && isFilled(d)));
  const overwritten = quick ? targets.filter(isFilled).length : 0;
  // Ce qui manque pour enregistrer, dit à côté du bouton plutôt qu'un bouton grisé muet.
  const missing =
    quickMode === "week" && quick
      ? !weekChosen
        ? "Choisissez une disponibilité pour au moins un jour de la semaine."
        : undefined
      : value === undefined
        ? "Choisissez d’abord une disponibilité."
        : undefined;
  const nothing =
    !missing && quick && !targets.length
      ? spare && filledInPeriod
        ? "Tous les jours concernés sont déjà renseignés : rien à compléter."
        : "Aucun jour ne correspond à cette sélection."
      : undefined;
  const hint = missing ?? nothing;

  // Toute écriture d'un jour remet la réponse à valider, même à valeur égale
  // (check_availability_write, 0001_foundation.sql). « Disponibilités
  // modifiées » laissait croire à l'agent qu'il avait fini (C2).
  const unvalidates = validated ? "Votre réponse est à valider de nouveau" : undefined;
  // Awaited on purpose: the dialog stays open when the database refuses, so the
  // refusal is read next to the entry that caused it.
  async function save() {
    if (hint) return;
    const success = unvalidates && `Disponibilités modifiées. ${unvalidates}`;
    const done =
      quick && quickMode === "week"
        ? await run(
            {
              type: "applyWeek",
              campaignId,
              week: Object.fromEntries(Object.entries(week).filter(([, v]) => v)) as Record<string, Availability>,
              from: start,
              to: end,
              keepFilled,
              comment,
              remember,
            },
            success,
          )
        : await run({ type: "availability", campaignId, dates: targets, value: value ?? null, comment }, success);
    if (done) {
      setDay(null);
      setQuick(false);
    }
  }
  function openDay(date: string) {
    const entry = state.entries[entryKey(campaignId, actor.id, date)];
    setDay(date);
    setValue(entry?.type);
    setComment(entry?.comment ?? "");
  }
  function openQuick() {
    setQuick(true);
    setValue(undefined);
    setComment("");
    setStart(days[0]);
    setEnd(days[days.length - 1]);
    setKeepFilled(true);
    setWeek({ ...state.template });
    setRemember(true);
  }
  const choices = (
    <div className="availability-choices">
      {Object.entries(labels).map(([key, label]) => (
        <button
          key={key}
          aria-pressed={value === key}
          className={`${label.className} ${value === key ? "chosen" : ""}`}
          onClick={() => setValue(key as Availability)}
        >
          <strong>{label.short}</strong>
          <span>{label.label}</span>
          {/* Les horaires viennent de la campagne, jamais d'un libellé écrit
              en dur : chaque campagne fige les siens à sa création. */}
          {key !== "UNAVAILABLE" && <small>{hours(campaign, key as Shift | "FULL_24H")}</small>}
          {value === key && <Check size={14} />}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <PageTitle
        title="Mes disponibilités"
        description={`${monthLabel(campaign.month)} · saisie puis validation explicite de votre réponse.`}
        action={
          /* Le bouton plein de cet écran est « Valider », en bas de la saisie. */
          <Button variant="secondary" disabled={!open} onClick={openQuick}>
            <Zap size={17} />
            Saisie rapide
          </Button>
        }
      />
      <div className={`response-banner ${validated ? "validated" : ""}`}>
        <ProgressRing
          percent={days.length ? (filled / days.length) * 100 : 0}
          size="sm"
          tone={validated ? "green" : "blue"}
        />
        <div className="response-banner-body">
          <strong>
            {validated
              ? "Votre réponse est validée"
              : `${filled} / ${days.length} ${plural(days.length, "jour")} ${plural(days.length, "renseigné")}`}
          </strong>
          <div className="mini-progress">
            <i style={{ width: `${days.length ? (filled / days.length) * 100 : 0}%` }} />
          </div>
          <p>
            {validated
              ? "Toute modification nécessitera une nouvelle validation."
              : `Renseignez votre mois, puis validez explicitement votre réponse avant le ${dateLabel(campaign.closesOn)}.`}
          </p>
        </div>
        {/* Ce qui reste à faire prime sur l'état : tant qu'il manque des jours,
            c'est le nombre qui manque que l'agent doit lire, pas « à valider ». */}
        {!validated && open && days.length - filled > 0 ? (
          <span className="pill pill-red">
            <CircleAlert size={14} />
            {days.length - filled} {plural(days.length - filled, "jour")}{" "}
            {plural(days.length - filled, "reste", "restent")} à renseigner
          </span>
        ) : (
          <span className={`pill ${validated ? "pill-green" : "pill-orange"}`}>
            {validated ? "Validée" : "À valider"}
          </span>
        )}
      </div>
      {!open && (
        <div className="warning">
          <CircleAlert size={19} />
          Cette campagne est fermée. Vos disponibilités restent consultables.
        </div>
      )}
      <div className="availability-layout">
        <Panel title={monthLabel(campaign.month)} subtitle={`${hours(campaign, "DAY")} · ${hours(campaign, "NIGHT")}`}>
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
                  onClick={() => openDay(d)}
                  className={`calendar-day ${entry ? labels[entry.type].className : "unknown"} ${day === d ? "is-selected" : ""}`}
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
        </Panel>
        <div className="availability-side">
          {/* Le compte et la barre vivent dans le bandeau du haut depuis qu'il
              porte l'anneau : les répéter ici disait trois fois le même nombre.
              Ce panneau ne garde que ce qui lui appartient — la validation. */}
          <Panel title="Validation de la réponse" subtitle="La saisie ne vaut pas validation.">
            <p className="muted">
              {days.length - filled > 0
                ? `${days.length - filled} ${plural(days.length - filled, "jour")} ${plural(days.length - filled, "reste", "restent")} à renseigner. Pensez à indiquer vos indisponibilités.`
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
      {/* Sur téléphone, la validation passe sous le calendrier et sa légende :
          l'agent qui venait de remplir son mois, ou d'en corriger un jour, ne la
          voyait pas et partait sans avoir répondu (C2). Le mois complet, le geste
          qui reste suit le défilement. Au-delà de 1000 px le panneau est à côté
          du calendrier, et la barre ne s'affiche pas. */}
      {open && !validated && filled === days.length && (
        <div className="validate-bar">
          <span>
            <strong>
              {filled} / {days.length}
            </strong>{" "}
            {plural(days.length, "jour")} {plural(days.length, "renseigné")}
          </span>
          <Button onClick={() => run({ type: "validate", campaignId })}>
            <CheckCheck size={18} />
            Valider
          </Button>
        </div>
      )}
      <Modal
        open={Boolean(day) || quick}
        onOpenChange={o => {
          if (!o) {
            setDay(null);
            setQuick(false);
          }
        }}
        title={quick || !day ? "Saisie rapide" : dateLabel(day, { weekday: "long", day: "numeric", month: "long" })}
        description={
          quick
            ? "Plusieurs jours en une fois. Ils seront enregistrés en brouillon jusqu’à votre validation."
            : "Choisissez une disponibilité. Elle sera enregistrée en brouillon jusqu’à votre validation."
        }
      >
        {quick && (
          <>
            {/* « Période » : une même valeur sur chaque jour. « Semaine type » : une
                valeur par jour de semaine — c'est l'ancienne disponibilité
                habituelle, et l'ancien onglet « Jours de la semaine », réunis. */}
            <SegmentedTabs
              size="lg"
              label="Façon de remplir"
              value={quickMode}
              onChange={setQuickMode}
              options={[
                { value: "period", label: "Période", icon: CalendarRange },
                { value: "week", label: "Semaine type", icon: CalendarDays },
              ]}
            />
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
          </>
        )}
        {quick && quickMode === "week" ? (
          <>
            <div className="weekly-template">
              {weekdayNames.map((name, index) => {
                const weekday = String(index + 1);
                const current = week[weekday];
                return (
                  <div key={weekday}>
                    <span>{name}</span>
                    <div className="weekly-choices">
                      {(Object.keys(labels) as Availability[]).map(type => (
                        <button
                          key={type}
                          type="button"
                          aria-pressed={current === type}
                          aria-label={`${name} : ${labels[type].label}`}
                          className={`badge ${labels[type].className} ${current === type ? "chosen" : ""}`}
                          onClick={() => setWeek(w => ({ ...w, [weekday]: current === type ? undefined : type }))}
                        >
                          {labels[type].short}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="muted small">Un jour sans choix ne change pas. Touchez de nouveau un choix pour l’enlever.</p>
            <label className="checkbox-field quick-option">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              <span>
                Garder comme ma semaine habituelle
                <small>Elle sera préremplie ici les prochains mois.</small>
              </span>
            </label>
          </>
        ) : (
          <>
            {choices}
            <button className="text-button" onClick={() => setValue(null)}>
              {value === null ? "✓ " : ""}Remettre à « Non renseigné »
            </button>
          </>
        )}
        {quick && filledInPeriod > 0 && !(quickMode === "period" && value === null) && (
          <label className="checkbox-field quick-option">
            <input type="checkbox" checked={keepFilled} onChange={e => setKeepFilled(e.target.checked)} />
            <span>
              Ne remplir que les jours non renseignés
              <small>
                {filledInPeriod} {plural(filledInPeriod, "jour")} de la période {plural(filledInPeriod, "est", "sont")}{" "}
                déjà {plural(filledInPeriod, "renseigné")}.
              </small>
            </span>
          </label>
        )}
        {quick && targets.length > 0 && (
          <div className="quick-summary">
            <CalendarDays size={17} />
            <span>
              <strong>
                {targets.length} {plural(targets.length, "jour")} {plural(targets.length, "sera", "seront")}{" "}
                {quickMode === "period" && value === null ? "effacé" : "renseigné"}
                {targets.length > 1 ? "s" : ""}
              </strong>
              <small>
                Du {dateLabel(targets[0], { weekday: "long", day: "numeric", month: "long" })} au{" "}
                {dateLabel(targets[targets.length - 1], { weekday: "long", day: "numeric", month: "long" })}
              </small>
            </span>
          </div>
        )}
        <label className="field">
          Commentaire facultatif
          <textarea
            maxLength={500}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Une précision à transmettre au responsable…"
          />
        </label>
        {/* Un jour ouvert depuis le calendrier montre déjà sa valeur cochée : lui
            annoncer qu'elle « sera remplacée » n'apprenait rien. L'annonce reste
            pour la saisie rapide, qui touche des jours qu'on ne voit pas. */}
        {overwritten > 0 && (
          <div className="warning small">
            <CircleAlert size={18} />
            {overwritten} {plural(overwritten, "jour")} déjà {plural(overwritten, "renseigné")}{" "}
            {plural(overwritten, "sera", "seront")} remplacé{overwritten > 1 ? "s" : ""}.
          </div>
        )}
        {validated && (
          <div className="warning small">
            <CircleAlert size={18} />
            Votre réponse est validée : après ce changement, il faudra la valider de nouveau.
          </div>
        )}
        <Button
          className="full-width"
          disabled={Boolean(hint)}
          aria-describedby={hint ? "availability-choice-hint" : undefined}
          onClick={save}
        >
          {quick
            ? `Enregistrer ${targets.length > 1 ? `les ${targets.length} jours` : "le jour"}`
            : "Enregistrer la disponibilité"}
        </Button>
        {hint && (
          <p id="availability-choice-hint" className="muted small button-hint">
            {hint}
          </p>
        )}
      </Modal>
    </>
  );
}
