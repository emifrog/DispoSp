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
  UserPlus,
  X,
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
  auditFamilies,
  gradeLabel,
  memberRoles,
  monthLabel,
  plural,
  shiftKey,
  shiftMonth,
  type Agent,
  type AppState,
  type MemberRole,
} from "@/lib/domain";
import { auditCsv, download, personalCalendar } from "@/lib/exports";
import { roleLabels } from "@/lib/session";

export function Campaigns() {
  const { state, run, setCampaignId, connected } = useApp();
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
                      {count} / {state.agents.length} {plural(state.agents.length, "agent")}
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
          La création ouvre la campagne à tous les agents {connected ? "de votre centre" : "de cette démonstration"}.
          Les emails et rappels automatiques seront raccordés avec le service de notifications.
        </p>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Ouvrir une campagne"
        description="Les agents pourront renseigner leurs disponibilités jusqu’à la date de clôture."
      >
        <form
          onSubmit={form.handleSubmit(async data => {
            if (await run({ type: "campaign", ...data })) {
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
  const { state, run, connected, canAdminister } = useApp();
  const [search, setSearch] = useState("");
  const [edited, setEdited] = useState<Agent | null>(null);
  const [inviting, setInviting] = useState(false);
  const [team, setTeam] = useState<{ id?: string; name: string } | null>(null);
  // The database decides; this only keeps the screen from offering what it would
  // refuse — and the demonstration models none of these tables.
  const administering = connected && canAdminister;
  const matches = (a: Agent) =>
    `${a.name} ${a.team} ${a.grade} ${a.matricule}`.toLowerCase().includes(search.toLowerCase());
  return (
    <>
      <PageTitle
        eyebrow="VOTRE COLLECTIF"
        title="Agents & équipes"
        description={`${state.agents.length} ${plural(state.agents.length, "agent")} ${plural(state.agents.length, "réuni")} au sein du ${state.organization.name}.`}
        action={
          administering ? (
            <Button onClick={() => setInviting(true)}>
              <UserPlus size={17} />
              Inviter un agent
            </Button>
          ) : undefined
        }
      />
      <label className="search-field standalone-search">
        <Search size={17} />
        <input
          aria-label="Rechercher dans l’équipe"
          placeholder="Rechercher un nom, une équipe, un matricule…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </label>

      {administering && state.invitations.length > 0 && (
        <Panel
          title="Invitations en attente"
          subtitle="L’agent crée son compte lui-même ; le rattachement se fait à la confirmation de son adresse."
        >
          <div className="invitation-list">
            {state.invitations.map(invitation => (
              <div key={invitation.id}>
                <span>
                  <strong>{invitation.name}</strong>
                  <small>
                    {invitation.email} · {invitation.team} · {roleLabels[invitation.role] ?? invitation.role}
                  </small>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => run({ type: "revokeInvitation", invitationId: invitation.id })}
                >
                  Annuler
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="agents-grid">
        {state.agents.filter(matches).map(a => (
          <article className="profile-card" key={a.id}>
            <Avatar agent={a} />
            <h2>{a.name}</h2>
            <p>
              {gradeLabel(a)} · {a.team}
            </p>
            {(a.matricule || a.phone) && (
              <p className="muted small">{[a.matricule, a.phone].filter(Boolean).join(" · ")}</p>
            )}
            <div className="qualification-tags">
              {a.qualifications.map(q => (
                <span key={q}>{q}</span>
              ))}
            </div>
            {administering && (
              <Button size="sm" variant="secondary" onClick={() => setEdited(a)}>
                <Settings2 size={15} />
                Modifier
              </Button>
            )}
          </article>
        ))}
      </div>

      {administering && state.inactiveAgents.length > 0 && (
        <Panel title="Agents désactivés" subtitle="Ils ne comptent dans aucune synthèse et ne peuvent être affectés.">
          <div className="invitation-list">
            {state.inactiveAgents.filter(matches).map(a => (
              <div key={a.id}>
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {gradeLabel(a)} · {a.team}
                  </small>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEdited(a)}>
                  Réactiver
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {administering && (
        <Panel
          title="Équipes"
          subtitle="Une campagne appartient à une équipe ; renommer n’en déplace aucune."
          action={
            <Button size="sm" variant="secondary" onClick={() => setTeam({ name: "" })}>
              <Plus size={15} />
              Nouvelle équipe
            </Button>
          }
        >
          <div className="invitation-list">
            {state.teams.map(t => (
              <div key={t.id}>
                <span>
                  <strong>{t.name}</strong>
                  <small>
                    {state.agents.filter(a => a.teamId === t.id).length}{" "}
                    {plural(state.agents.filter(a => a.teamId === t.id).length, "agent")}
                  </small>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setTeam({ id: t.id, name: t.name })}>
                  Renommer
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {edited && <MemberDialog agent={edited} onClose={() => setEdited(null)} />}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      {team && <TeamDialog initial={team} onClose={() => setTeam(null)} />}
    </>
  );
}

function RecordFields({
  value,
  onChange,
}: {
  value: { name: string; grade: string; matricule: string; phone: string };
  onChange: (next: Partial<typeof value>) => void;
}) {
  return (
    <>
      <label className="field">
        Nom et prénom
        <input value={value.name} onChange={e => onChange({ name: e.target.value })} required maxLength={100} />
      </label>
      <label className="field">
        Grade ou fonction
        <input value={value.grade} onChange={e => onChange({ grade: e.target.value })} maxLength={60} />
      </label>
      <label className="field">
        Matricule
        <input value={value.matricule} onChange={e => onChange({ matricule: e.target.value })} maxLength={30} />
      </label>
      <label className="field">
        Téléphone
        <input value={value.phone} onChange={e => onChange({ phone: e.target.value })} maxLength={30} />
      </label>
    </>
  );
}

function TeamAndRole({
  teams,
  teamId,
  role,
  onChange,
}: {
  teams: AppState["teams"];
  teamId: string;
  role: MemberRole;
  onChange: (next: { teamId?: string; role?: MemberRole }) => void;
}) {
  return (
    <>
      <label className="field">
        Équipe
        <select value={teamId} onChange={e => onChange({ teamId: e.target.value })}>
          {teams.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Rôle
        <select value={role} onChange={e => onChange({ role: e.target.value as MemberRole })}>
          {memberRoles.map(r => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function MemberDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { state, run } = useApp();
  const [form, setForm] = useState({
    name: agent.name,
    grade: agent.grade,
    matricule: agent.matricule,
    phone: agent.phone,
    teamId: agent.teamId || (state.teams[0]?.id ?? ""),
    role: agent.role,
    active: state.agents.some(a => a.id === agent.id),
    qualifications: agent.qualifications,
  });
  const [added, setAdded] = useState("");
  // The catalogue plus whatever this agent already holds: a qualification
  // removed from the catalogue must not silently vanish from a record.
  const offered = [...new Set([...state.qualificationCatalogue, ...form.qualifications])].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  const toggle = (name: string) =>
    setForm(f => ({
      ...f,
      qualifications: f.qualifications.includes(name)
        ? f.qualifications.filter(q => q !== name)
        : [...f.qualifications, name],
    }));
  return (
    <Modal open onOpenChange={open => !open && onClose()} title={agent.name} description="Fiche, équipe et rôle.">
      <RecordFields value={form} onChange={next => setForm(f => ({ ...f, ...next }))} />
      <TeamAndRole
        teams={state.teams}
        teamId={form.teamId}
        role={form.role}
        onChange={next => setForm(f => ({ ...f, ...next }))}
      />
      <fieldset className="field">
        <legend>Qualifications</legend>
        <div className="qualification-choices">
          {offered.map(name => (
            <label key={name}>
              <input type="checkbox" checked={form.qualifications.includes(name)} onChange={() => toggle(name)} />
              {name}
            </label>
          ))}
        </div>
        <div className="inline-add">
          <input
            aria-label="Ajouter une qualification"
            placeholder="Ajouter une qualification…"
            value={added}
            maxLength={60}
            onChange={e => setAdded(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              const name = added.trim();
              if (!name || form.qualifications.includes(name)) return;
              setForm(f => ({ ...f, qualifications: [...f.qualifications, name] }));
              setAdded("");
            }}
          >
            Ajouter
          </Button>
        </div>
      </fieldset>
      <label className="field checkbox-field">
        <input
          type="checkbox"
          checked={form.active}
          onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
        />
        Agent actif
      </label>
      <Button
        className="full-width"
        onClick={async () => {
          if (await run({ type: "member", userId: agent.id, ...form })) onClose();
        }}
      >
        Enregistrer la fiche
      </Button>
    </Modal>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, run } = useApp();
  const empty = {
    email: "",
    name: "",
    grade: "",
    matricule: "",
    phone: "",
    teamId: state.teams[0]?.id ?? "",
    role: "AGENT" as MemberRole,
  };
  const [form, setForm] = useState(empty);
  return (
    <Modal
      open={open}
      onOpenChange={next => !next && onClose()}
      title="Inviter un agent"
      description="L’agent crée son propre compte. Le rattachement se fait automatiquement à la confirmation de son adresse."
    >
      <label className="field">
        Adresse électronique
        <input
          type="email"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          required
          maxLength={200}
        />
      </label>
      <RecordFields value={form} onChange={next => setForm(f => ({ ...f, ...next }))} />
      <TeamAndRole
        teams={state.teams}
        teamId={form.teamId}
        role={form.role}
        onChange={next => setForm(f => ({ ...f, ...next }))}
      />
      <Button
        className="full-width"
        onClick={async () => {
          if (await run({ type: "invite", ...form })) {
            setForm(empty);
            onClose();
          }
        }}
      >
        <UserPlus size={16} />
        Enregistrer l’invitation
      </Button>
      <p className="muted small">
        Transmettez-lui l’adresse de l’application : il s’inscrit avec cette même adresse électronique. L’envoi
        automatique arrivera avec le service de notifications.
      </p>
    </Modal>
  );
}

function TeamDialog({ initial, onClose }: { initial: { id?: string; name: string }; onClose: () => void }) {
  const { run } = useApp();
  const [name, setName] = useState(initial.name);
  return (
    <Modal
      open
      onOpenChange={open => !open && onClose()}
      title={initial.id ? "Renommer l’équipe" : "Nouvelle équipe"}
      description="Les campagnes déjà ouvertes gardent l’équipe à laquelle elles appartiennent."
    >
      <label className="field">
        Nom de l’équipe
        <input value={name} onChange={e => setName(e.target.value)} required maxLength={60} />
      </label>
      <Button
        className="full-width"
        onClick={async () => {
          if (await run({ type: "team", teamId: initial.id, name })) onClose();
        }}
      >
        Enregistrer
      </Button>
    </Modal>
  );
}

// A screen an administrator alone may read. The database says so too — the audit
// policy returns nothing to anyone else — but an empty page explains nothing.
function AdministrationOnly({ title }: { title: string }) {
  return (
    <>
      <PageTitle
        eyebrow="ACCÈS RÉSERVÉ"
        title={title}
        description="Cet écran est réservé à l’administration du centre."
      />
      <div className="info-card horizontal">
        <ShieldCheck size={24} />
        <p>
          Seuls les profils gestionnaire et administrateur y ont accès. Rapprochez-vous de l’administrateur de votre
          centre si vous pensez devoir en faire partie.
        </p>
      </div>
    </>
  );
}

export function Audit() {
  const { state, connected, canAdminister } = useApp();
  const [family, setFamily] = useState("");
  const [author, setAuthor] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  if (connected && !canAdminister) return <AdministrationOnly title="Historique des actions" />;
  const authors = [...new Set(state.audit.map(e => e.actor))].sort((a, b) => a.localeCompare(b, "fr"));
  const entities = auditFamilies.find(f => f.key === family)?.entities as readonly string[] | undefined;
  // La période se lit sur la date affichée, pas sur l'instant UTC : une action de
  // 23 h 30 appartient à la journée que le lecteur voit à l'écran.
  const dayOf = (event: AppState["audit"][number]) => localDate(new Date(event.at));
  // The trail is kept line by line on purpose; reading it back by the handful is
  // what this screen is for. A month filled by one agent is thirty-one lines.
  const shown = state.audit.filter(
    event =>
      (!entities || entities.includes(event.entity)) &&
      (!author || event.actor === author) &&
      (!from || dayOf(event) >= from) &&
      (!to || dayOf(event) <= to) &&
      `${event.action} ${event.detail}`.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")),
  );
  // Le journal chargé s'arrête aux deux cents dernières actions. Demander une
  // période plus ancienne ne renvoie rien, et ce silence se lirait comme « il ne
  // s'est rien passé » : l'écran dit donc jusqu'où il voit.
  const oldest = state.audit.length ? dayOf(state.audit[state.audit.length - 1]) : "";
  const beyondLoaded = Boolean(from && oldest && from < oldest && state.audit.length >= 200);
  return (
    <>
      <PageTitle
        eyebrow="TRAÇABILITÉ"
        title="Historique des actions"
        description={`Retrouvez les saisies, validations et publications ${connected ? "de votre centre" : "de cette démonstration"}.`}
        action={
          <Button
            variant="secondary"
            disabled={!shown.length}
            onClick={() => download(auditCsv(shown), `historique-${localDate()}.csv`, "text/csv;charset=utf-8")}
          >
            <Download size={17} />
            Exporter le journal
          </Button>
        }
      />
      <div className="table-filters">
        <label className="search-field">
          <Search size={17} />
          <input
            placeholder="Rechercher une action, un agent, une date…"
            aria-label="Rechercher dans l’historique"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <select aria-label="Filtrer par sujet" value={family} onChange={e => setFamily(e.target.value)}>
          <option value="">Tous les sujets</option>
          {auditFamilies.map(f => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <select aria-label="Filtrer par auteur" value={author} onChange={e => setAuthor(e.target.value)}>
          <option value="">Tous les auteurs</option>
          {authors.map(name => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <div className="period-filter">
          <label>
            <span>Du</span>
            <input
              type="date"
              aria-label="Début de la période"
              max={to || undefined}
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </label>
          <label>
            <span>au</span>
            <input
              type="date"
              aria-label="Fin de la période"
              min={from || undefined}
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </label>
          {(from || to) && (
            <Button
              size="icon"
              variant="secondary"
              aria-label="Effacer la période"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              <X size={15} />
            </Button>
          )}
        </div>
        <span className="muted small">
          {shown.length} {plural(shown.length, "action")} sur {state.audit.length}
        </span>
      </div>
      {beyondLoaded && (
        <div className="info-card horizontal">
          <CalendarDays size={22} />
          <p>
            Le journal chargé remonte au {dateLabel(oldest, { day: "numeric", month: "long", year: "numeric" })}. Les
            actions antérieures existent en base, mais ne sont pas affichées ici : cet écran montre les deux cents
            dernières.
          </p>
        </div>
      )}
      <Panel
        title="Dernières modifications"
        subtitle={
          state.audit.length >= 200
            ? "Les deux cents dernières actions du centre."
            : `${state.audit.length} ${plural(state.audit.length, "action")} ${plural(state.audit.length, "enregistrée")}`
        }
      >
        {!shown.length && <p className="muted small empty-filters">Aucune action ne correspond à ces filtres.</p>}
        <ol className="audit-list">
          {shown.map(event => (
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
        <div className="panel-footnote">
          L’export reprend la vue filtrée, telle qu’elle est affichée, et non l’intégralité du journal.
        </div>
      </Panel>
    </>
  );
}

export function Settings() {
  const { state, run, connected, canAdminister } = useApp();
  const [dayStart, setDayStart] = useState(state.organization.dayStart);
  const [nightStart, setNightStart] = useState(state.organization.nightStart);
  if (connected && !canAdminister) return <AdministrationOnly title="Paramètres du centre" />;
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
  const { state, actor, agent, selectAgent, connected } = useApp();
  return (
    <>
      <PageTitle
        eyebrow="ESPACE AGENT"
        title="Mon profil"
        description="Vos informations d’équipe et vos qualifications."
      />
      <div className="settings-width">
        <Panel title={agent.name} subtitle={`${gradeLabel(agent)} · ${agent.team}`}>
          <div className="profile-details">
            <Avatar agent={agent} />
            <div className="qualification-tags">
              {agent.qualifications.map(q => (
                <span key={q}>{q}</span>
              ))}
            </div>
          </div>
          <dl className="record-fields">
            <div>
              <dt>Matricule</dt>
              <dd>{agent.matricule || "—"}</dd>
            </div>
            <div>
              <dt>Téléphone</dt>
              <dd>{agent.phone || "—"}</dd>
            </div>
          </dl>
        </Panel>
        {/* Simulation control. On real data it would present someone else's
            record as fictional, so it never renders in connected mode. */}
        {!connected && (
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
        )}
      </div>
    </>
  );
}
