"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type z } from "zod";
import {
  CalendarDays,
  CalendarCheck2,
  CheckCheck,
  Download,
  LockKeyhole,
  Megaphone,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  UnlockKeyhole,
} from "lucide-react";
import { useApp } from "./provider";
import { Avatar, PageTitle, Panel } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import {
  campaignFormSchema,
  dateLabel,
  hours,
  isOpen,
  isValidated,
  lastDayOfMonth,
  localDate,
  localMonth,
  monthDays,
  monthLabel,
  shiftKey,
  shiftMonth,
} from "@/lib/domain";
import { download, personalCalendar } from "@/lib/exports";

export function Campaigns() {
  const { state, run, setCampaignId } = useApp();
  const [open, setOpen] = useState(false);
  // Propose the first month no campaign covers yet, and collect responses during
  // the month before it, so the dialog never opens on a window already past.
  const nextMonth = state.campaigns.reduce(
    (month, c) => (c.month >= month ? shiftMonth(c.month, 1) : month),
    shiftMonth(localMonth(), 1),
  );
  const form = useForm<z.infer<typeof campaignFormSchema>>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: { name: "", month: nextMonth, closesOn: lastDayOfMonth(shiftMonth(nextMonth, -1)) },
  });
  return (
    <>
      <PageTitle
        eyebrow="ORGANISATION"
        title="Campagnes de disponibilités"
        description="Ouvrez la collecte, suivez les réponses et préparez le prochain mois."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Nouvelle campagne
          </Button>
        }
      />
      <div className="campaign-list">
        {state.campaigns.map(c => {
          const count = state.agents.filter(a => isValidated(state, c.id, a.id)).length;
          return (
            <Panel
              key={c.id}
              title={c.name}
              subtitle={monthLabel(c.month)}
              action={
                <span className={`pill ${isOpen(c) ? "pill-green" : "pill-gray"}`}>
                  {isOpen(c) ? "Ouverte" : "Fermée"}
                </span>
              }
            >
              <div className="campaign-details">
                <span>
                  <CalendarDays size={19} />
                  <span>
                    Fenêtre de réponse
                    <strong>
                      {dateLabel(c.opensOn)} — {dateLabel(c.closesOn)}
                    </strong>
                  </span>
                </span>
                <span>
                  <CheckCheck size={19} />
                  <span>
                    Réponses validées
                    <strong>
                      {count} / {state.agents.length} agents
                    </strong>
                  </span>
                </span>
                <span>
                  <Settings2 size={19} />
                  <span>
                    Horaires de la campagne
                    <strong>
                      {hours(c, "DAY")} / {hours(c, "NIGHT")}
                    </strong>
                  </span>
                </span>
              </div>
              <div className="campaign-buttons">
                <Button asChild onClick={() => setCampaignId(c.id)}>
                  <Link href="/disponibilites">Consulter les réponses</Link>
                </Button>
                <Button variant="secondary" onClick={() => run({ type: "close", campaignId: c.id, closed: !c.closed })}>
                  {c.closed ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />}
                  {c.closed ? "Déverrouiller" : "Verrouiller la saisie"}
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>
      <div className="info-card horizontal">
        <Megaphone size={24} />
        <p>
          La création ouvre la campagne à tous les agents de cette démonstration. Les emails et rappels automatiques
          seront raccordés avec le service de notifications.
        </p>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Ouvrir une campagne"
        description="Les agents pourront renseigner leurs disponibilités jusqu’à la date de clôture."
      >
        <form
          onSubmit={form.handleSubmit(data => {
            if (run({ type: "campaign", ...data })) {
              setOpen(false);
              form.reset();
            }
          })}
        >
          <label className="field">
            Nom de la campagne
            <input {...form.register("name")} placeholder="Disponibilités de novembre" />
          </label>
          {form.formState.errors.name && <p className="field-error">{form.formState.errors.name.message}</p>}
          <div className="form-grid">
            <label>
              Mois concerné
              <input type="month" {...form.register("month")} />
            </label>
            <label>
              Clôture des réponses
              <input type="date" min={localDate()} {...form.register("closesOn")} />
            </label>
          </div>
          {form.formState.errors.month && <p className="field-error">{form.formState.errors.month.message}</p>}
          {form.formState.errors.closesOn && <p className="field-error">{form.formState.errors.closesOn.message}</p>}
          <p className="muted small">
            Horaires : {state.organization.dayStart} h–{state.organization.nightStart} h et{" "}
            {state.organization.nightStart} h–{state.organization.dayStart} h le lendemain.
          </p>
          <Button type="submit" className="full-width">
            <Plus size={16} />
            Créer et ouvrir la campagne
          </Button>
        </form>
      </Modal>
    </>
  );
}

export function Agents() {
  const { state } = useApp();
  const [search, setSearch] = useState("");
  return (
    <>
      <PageTitle
        eyebrow="VOTRE COLLECTIF"
        title="Agents & équipes"
        description={`${state.agents.length} agents réunis au sein du ${state.organization.name}.`}
      />
      <label className="search-field standalone-search">
        <Search size={17} />
        <input
          aria-label="Rechercher dans l’équipe"
          placeholder="Rechercher un nom, une équipe…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </label>
      <div className="agents-grid">
        {state.agents
          .filter(a => `${a.name} ${a.team}`.toLowerCase().includes(search.toLowerCase()))
          .map(a => (
            <article className="profile-card" key={a.id}>
              <Avatar agent={a} />
              <h2>{a.name}</h2>
              <p>
                {a.grade} · {a.team}
              </p>
              <div className="qualification-tags">
                {a.qualifications.map(q => (
                  <span key={q}>{q}</span>
                ))}
              </div>
            </article>
          ))}
      </div>
    </>
  );
}

export function Audit() {
  const { state } = useApp();
  return (
    <>
      <PageTitle
        eyebrow="TRAÇABILITÉ"
        title="Historique des actions"
        description="Retrouvez les saisies, validations et publications de cette démonstration."
      />
      <Panel title="Dernières modifications" subtitle={`${state.audit.length} action(s) enregistrée(s)`}>
        <ol className="audit-list">
          {state.audit.map(event => (
            <li key={event.id}>
              <span className="audit-icon">
                <CheckCheck size={18} />
              </span>
              <div>
                <h3>{event.action}</h3>
                <p>{event.detail}</p>
                <small>
                  {event.actor} ·{" "}
                  {new Date(event.at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                </small>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

export function Settings() {
  const { state, run } = useApp();
  const [dayStart, setDayStart] = useState(state.organization.dayStart);
  const [nightStart, setNightStart] = useState(state.organization.nightStart);
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Paramètres du centre"
        description="Un cadre commun pour vos prochaines campagnes."
      />
      <div className="settings-width">
        <Panel title="Horaires par défaut" subtitle="Ils sont appliqués uniquement aux nouvelles campagnes.">
          <form
            onSubmit={e => {
              e.preventDefault();
              run({ type: "settings", dayStart, nightStart });
            }}
          >
            <div className="form-grid">
              <label>
                Début du Jour
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={dayStart}
                  onChange={e => setDayStart(Number(e.target.value))}
                />
              </label>
              <label>
                Début de la Nuit
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={nightStart}
                  onChange={e => setNightStart(Number(e.target.value))}
                />
              </label>
            </div>
            <p className="muted">
              La nuit appartient à sa date de début. Le créneau 24 h couvre le Jour puis la Nuit, jusqu’au lendemain
              matin.
            </p>
            <Button type="submit">Enregistrer les horaires</Button>
          </form>
        </Panel>
        <div className="info-card horizontal">
          <ShieldCheck size={24} />
          <p>
            Les horaires des campagnes existantes sont conservés pour préserver la cohérence des disponibilités et des
            plannings déjà saisis.
          </p>
        </div>
      </div>
    </>
  );
}

export function PersonalPlanning() {
  const { state, actor, campaignId, campaign } = useApp();
  const shifts = monthDays(campaign.month).flatMap(date =>
    (["DAY", "NIGHT"] as const).flatMap(shift => {
      const published = state.publications[shiftKey(campaignId, date, shift)];
      return published?.agents.includes(actor.id) ? [{ date, shift, published }] : [];
    }),
  );
  return (
    <>
      <PageTitle
        eyebrow="ESPACE AGENT"
        title="Mon planning"
        description={`${monthLabel(campaign.month)} · Vos gardes publiées par le responsable.`}
        action={
          <Button
            variant="secondary"
            disabled={!shifts.length}
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
      <Panel title="Mes affectations publiées" subtitle="Les brouillons du responsable ne sont pas affichés ici.">
        {!shifts.length ? (
          <div className="empty-state">
            <CalendarCheck2 size={40} />
            <h2>Aucune garde publiée pour ce mois</h2>
            <p>Vos affectations apparaîtront ici après publication par le responsable.</p>
            <Button variant="secondary" asChild>
              <Link href="/mes-disponibilites">Vérifier mes disponibilités</Link>
            </Button>
          </div>
        ) : (
          <div className="personal-shifts">
            {shifts.map(s => (
              <article key={`${s.date}-${s.shift}`}>
                <div className={`shift-date ${s.shift === "DAY" ? "day" : "night"}`}>
                  <small>{dateLabel(s.date, { weekday: "short" })}</small>
                  <strong>{Number(s.date.slice(-2))}</strong>
                  <small>{dateLabel(s.date, { month: "short" })}</small>
                </div>
                <div>
                  <h3>Garde {s.shift === "DAY" ? "de jour" : "de nuit"}</h3>
                  <p>
                    {state.organization.name} · {hours(campaign, s.shift)}
                  </p>
                  <small>
                    Version {s.published.revision} · publiée le {dateLabel(s.published.publishedAt.slice(0, 10))}
                  </small>
                </div>
                <span className="pill pill-green">Publiée</span>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

export function Profile() {
  const { state, actor, agent, selectAgent } = useApp();
  return (
    <>
      <PageTitle
        eyebrow="ESPACE AGENT"
        title="Mon profil"
        description="Vos informations d’équipe et vos qualifications."
      />
      <div className="settings-width">
        <Panel title={agent.name} subtitle={`${agent.grade} · ${agent.team}`}>
          <div className="profile-details">
            <Avatar agent={agent} />
            <div className="qualification-tags">
              {agent.qualifications.map(q => (
                <span key={q}>{q}</span>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Tester un autre agent" subtitle="Contrôle réservé à cet espace de démonstration.">
          <label className="field">
            Agent de démonstration
            <select value={actor.id} onChange={e => selectAgent(e.target.value)}>
              {state.agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Ce choix ne constitue pas une connexion à un compte. Les données restent fictives et locales.
          </p>
        </Panel>
      </div>
    </>
  );
}
