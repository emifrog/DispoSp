"use client";
import { useState } from "react";
import Link from "next/link";
import { CalendarCheck2, CalendarDays, CircleAlert, Clock3, Download, History, Moon, Send, Sun } from "lucide-react";
import { useApp } from "./provider";
import { PageTitle, Panel, SegmentedTabs } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { download, personalCalendar } from "@/lib/exports";
import {
  dateLabel,
  hours,
  localDate,
  monthDays,
  monthLabel,
  plural,
  publishedShiftsOf,
  type PublishedShift as Assigned,
  type Shift,
} from "@/lib/domain";

// Le nombre de jours qui séparent deux dates, compté sur les dates elles-mêmes
// et non sur les instants : « dans 2 jours » ne doit pas dépendre de l'heure
// qu'il est, sans quoi la même garde serait à 1 ou 2 jours selon le moment où
// l'écran est ouvert.
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86400000);

const whenLabel = (days: number) => (days === 0 ? "aujourd’hui" : days === 1 ? "demain" : `dans ${days} jours`);

export function PersonalPlanning() {
  const { state, actor, campaignId, campaign, run } = useApp();
  const [tab, setTab] = useState<"upcoming" | "calendar" | "past">("upcoming");
  const [withdrawing, setWithdrawing] = useState<Assigned | null>(null);
  const [reason, setReason] = useState("");
  const today = localDate();
  const days = monthDays(campaign.month);

  // Une affectation n'existe pour l'agent qu'une fois publiée : le brouillon du
  // gestionnaire change encore, et l'annoncer serait promettre une garde que
  // personne n'a arrêtée.
  //
  // Ce qui est à venir se lit sur toutes les campagnes : celle qu'on choisit
  // par défaut est le mois qui attend une réponse, et la prochaine garde
  // appartient souvent au mois en cours. Le calendrier et l'historique, eux,
  // montrent le mois choisi.
  const all = publishedShiftsOf(state, actor.id);
  const assigned = all.filter(a => a.campaign.id === campaignId);
  const upcoming = all.filter(a => a.date >= today);
  const past = assigned.filter(a => a.date < today).reverse();
  const next = upcoming[0];
  const shown = tab === "past" ? past : upcoming;

  return (
    <>
      <PageTitle
        title="Mon planning"
        description={`Vos gardes telles qu’elles ont été publiées. Calendrier et historique : ${monthLabel(campaign.month)}.`}
        action={
          <Button
            variant="secondary"
            disabled={!assigned.length}
            onClick={() =>
              download(
                personalCalendar(state, campaign, actor.id),
                `planning-${campaign.month}.ics`,
                "text/calendar;charset=utf-8",
              )
            }
          >
            <Download size={17} />
            Exporter mon calendrier
          </Button>
        }
      />

      <SegmentedTabs
        size="lg"
        label="Vue du planning"
        value={tab}
        onChange={setTab}
        options={[
          { value: "upcoming", label: "À venir", icon: CalendarCheck2 },
          { value: "calendar", label: "Calendrier", icon: CalendarDays },
          { value: "past", label: "Historique", icon: History },
        ]}
      />

      {/* La prochaine garde n'appartient à aucun onglet : c'est ce que l'agent
          vient vérifier, et elle reste sous les yeux quel que soit l'onglet. */}
      {next && (
        <div className={`next-shift ${next.shift === "DAY" ? "day" : "night"}`}>
          <span className="next-shift-icon">{next.shift === "DAY" ? <Sun size={22} /> : <Moon size={22} />}</span>
          <div>
            <strong>Prochaine garde {whenLabel(daysBetween(today, next.date))}</strong>
            <p>{dateLabel(next.date, { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <span className="pill pill-blue">
            <Clock3 size={14} />
            {hours(next.campaign, next.shift)}
          </span>
          <span className="next-shift-place">
            {state.organization.name}
            <small>Garde {next.shift === "DAY" ? "de jour" : "de nuit"}</small>
          </span>
        </div>
      )}

      {tab === "calendar" ? (
        <Panel
          title={monthLabel(campaign.month)}
          subtitle="Vos gardes publiées sur le mois. Les jours vides ne sont pas des repos : ils ne portent simplement aucune affectation."
        >
          <MonthStrip assigned={assigned} days={days} today={today} />
        </Panel>
      ) : (
        <Panel
          title={tab === "past" ? "Mes gardes passées" : "Mes prochaines affectations"}
          subtitle={
            tab === "past"
              ? `Sur ${monthLabel(campaign.month)}. L’historique des mois précédents n’est pas chargé.`
              : "Toutes campagnes confondues. Les brouillons du gestionnaire ne sont pas affichés ici."
          }
          action={
            shown.length ? (
              <span className="pill pill-gray">
                {shown.length} {plural(shown.length, "garde")}
              </span>
            ) : undefined
          }
        >
          {!shown.length ? (
            <div className="empty-state">
              <CalendarCheck2 size={40} />
              <h2>{tab === "past" ? "Aucune garde passée ce mois-ci" : "Aucune garde publiée à venir"}</h2>
              <p>
                {tab === "past"
                  ? "Les gardes déjà effectuées sur la campagne en cours apparaîtront ici."
                  : "Vos affectations apparaîtront ici après publication par le gestionnaire."}
              </p>
              <Button variant="secondary" asChild>
                <Link href="/mes-disponibilites">Vérifier mes disponibilités</Link>
              </Button>
            </div>
          ) : (
            <div className="personal-shifts">
              {shown.map(s => (
                <article key={`${s.campaign.id}-${s.date}-${s.shift}`}>
                  <div className={`shift-date ${s.shift === "DAY" ? "day" : "night"}`}>
                    <small>{dateLabel(s.date, { weekday: "short" })}</small>
                    <strong>{Number(s.date.slice(-2))}</strong>
                    <small>{dateLabel(s.date, { month: "short" })}</small>
                  </div>
                  <div>
                    <h3>Garde {s.shift === "DAY" ? "de jour" : "de nuit"}</h3>
                    <p>
                      {state.organization.name} · {hours(s.campaign, s.shift)}
                    </p>
                    <small>
                      {/* Le jour de Paris : les dix premiers caractères de
                          l'horodatage sont le jour UTC, la veille après minuit. */}
                      Version {s.revision} · publiée le {dateLabel(localDate(new Date(s.publishedAt)))}
                    </small>
                  </div>
                  {tab === "past" ? (
                    <span className="pill pill-gray">Effectuée</span>
                  ) : (
                    <WithdrawalState
                      withdrawal={state.withdrawals.find(
                        w =>
                          w.campaignId === s.campaign.id &&
                          w.date === s.date &&
                          w.shift === s.shift &&
                          w.userId === actor.id &&
                          w.state !== "CANCELLED",
                      )}
                      onAsk={() => {
                        setWithdrawing(s);
                        setReason("");
                      }}
                      onCancel={id => run({ type: "cancelWithdrawal", withdrawalId: id })}
                    />
                  )}
                </article>
              ))}
            </div>
          )}
        </Panel>
      )}

      {withdrawing && (
        <Modal
          open
          onOpenChange={next => !next && setWithdrawing(null)}
          title="Je ne peux plus tenir cette garde"
          description={`${dateLabel(withdrawing.date, { weekday: "long", day: "numeric", month: "long" })} · garde ${withdrawing.shift === "DAY" ? "de jour" : "de nuit"}. Votre encadrement en est averti et vous répond.`}
        >
          <div className="warning small">
            <CircleAlert size={18} />
            Vous restez attendu sur cette garde tant que votre encadrement n’a pas répondu. Un désistement n’est pas une
            annulation.
          </div>
          <label className="field">
            Motif (facultatif)
            <textarea
              maxLength={500}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Convocation, obligation familiale, arrêt…"
            />
          </label>
          <Button
            className="full-width"
            onClick={async () => {
              const ok = await run({
                type: "withdraw",
                // La campagne de la garde, et non celle du sélecteur : l'onglet
                // « À venir » montre aussi les gardes des autres mois.
                campaignId: withdrawing.campaign.id,
                date: withdrawing.date,
                shift: withdrawing.shift,
                reason,
              });
              if (ok) setWithdrawing(null);
            }}
          >
            <Send size={17} />
            Signaler mon désistement
          </Button>
        </Modal>
      )}

      <div className="planning-exports">
        <button
          className="shortcut shortcut-primary"
          disabled={!assigned.length}
          onClick={() =>
            download(
              personalCalendar(state, campaign, actor.id),
              `planning-${campaign.month}.ics`,
              "text/calendar;charset=utf-8",
            )
          }
        >
          <span className="shortcut-icon">
            <CalendarDays size={20} />
          </span>
          <span>
            <strong>Ajouter tout à mon calendrier</strong>
            <small>Exporter mes gardes vers Google, Apple ou Outlook</small>
          </span>
          <Download size={18} />
        </button>
      </div>
    </>
  );
}

/**
 * L'état du désistement sur une garde à venir, ou le moyen d'en signaler un.
 *
 * Tant qu'il est en attente, l'agent peut le retirer : c'est son geste, il peut
 * s'être trompé, et une demande retirée vaut mieux qu'un encadrement qui
 * réaffecte pour rien.
 */
function WithdrawalState({
  withdrawal,
  onAsk,
  onCancel,
}: {
  withdrawal?: { id: string; state: string };
  onAsk: () => void;
  onCancel: (id: string) => void;
}) {
  if (!withdrawal)
    return (
      <Button size="sm" variant="ghost" onClick={onAsk}>
        <Send size={15} />
        Je ne peux plus
      </Button>
    );
  if (withdrawal.state === "PENDING")
    return (
      <span className="withdrawal-pending">
        <span className="pill pill-orange">Désistement en attente</span>
        <button type="button" className="text-button" onClick={() => onCancel(withdrawal.id)}>
          Retirer
        </button>
      </span>
    );
  return (
    <span className={`pill ${withdrawal.state === "ACCEPTED" ? "pill-green" : "pill-red"}`}>
      {withdrawal.state === "ACCEPTED" ? "Désistement accepté" : "Désistement refusé"}
    </span>
  );
}

/** Le mois en une bande : un jour par case, le code de la garde s'il y en a une. */
function MonthStrip({ assigned, days, today }: { assigned: Assigned[]; days: string[]; today: string }) {
  const byDate = new Map<string, Shift[]>();
  for (const a of assigned) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a.shift]);
  // Le mois ne commence pas un lundi : les cases vides d'avant gardent
  // l'alignement des colonnes sur les jours de semaine.
  const leading = (new Date(`${days[0]}T12:00:00`).getDay() + 6) % 7;
  return (
    <div className="my-month">
      {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(name => (
        <div className="weekday" key={name}>
          {name}
        </div>
      ))}
      {Array.from({ length: leading }, (_, i) => (
        <div key={`lead-${i}`} />
      ))}
      {days.map(date => {
        const shifts = byDate.get(date) ?? [];
        const code = shifts.length === 2 ? "24" : shifts[0] === "DAY" ? "J" : shifts[0] === "NIGHT" ? "N" : "—";
        const tone = shifts.length === 2 ? "full" : shifts[0] === "DAY" ? "day" : shifts[0] === "NIGHT" ? "night" : "";
        return (
          <div
            key={date}
            className={`my-day ${tone} ${date === today ? "is-today" : ""}`}
            title={
              shifts.length
                ? `${dateLabel(date, { weekday: "long", day: "numeric", month: "long" })} : garde ${shifts.length === 2 ? "de 24 h" : shifts[0] === "DAY" ? "de jour" : "de nuit"}`
                : `${dateLabel(date, { weekday: "long", day: "numeric", month: "long" })} : aucune garde`
            }
          >
            <b>{Number(date.slice(-2))}</b>
            <span>{code}</span>
          </div>
        );
      })}
    </div>
  );
}
