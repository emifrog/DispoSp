"use client";
import { useState } from "react";
import { Check, CircleAlert, Megaphone, Moon, Send, Sun, UserPlus, Users, X } from "lucide-react";
import { useApp } from "./provider";
import { Avatar, PageTitle, Panel } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { useConfirmation } from "./ui/confirm";
import {
  callNeedText,
  dateLabel,
  declarationText,
  hours,
  plural,
  stampLabel,
  workload,
  type AppState,
  type Shift,
} from "@/lib/domain";

type Call = AppState["calls"][number];
type Proposal = AppState["callProposals"][number];

const callStates: Record<Call["state"], string> = {
  OPEN: "En cours",
  RESOLVED: "Pourvue",
  CANCELLED: "Annulé",
  EXPIRED: "Expiré",
};
const proposalStates: Record<Proposal["state"], string> = {
  PENDING: "En attente de confirmation du gestionnaire",
  SELECTED: "Retenue dans le brouillon — la garde n’est pas encore confirmée",
  CONFIRMED: "Confirmée : la garde est à votre planning",
  WITHDRAWN: "Retirée",
  DECLINED: "Non retenue",
  RELEASED: "Retirée du planning",
};
const proposalPills: Record<Proposal["state"], string> = {
  PENDING: "pill-orange",
  SELECTED: "pill-blue",
  CONFIRMED: "pill-green",
  WITHDRAWN: "pill-gray",
  DECLINED: "pill-gray",
  RELEASED: "pill-gray",
};
const active = (p: Proposal) => p.state === "PENDING" || p.state === "SELECTED" || p.state === "CONFIRMED";
const slotLabel = (call: Pick<Call, "date" | "shift">) =>
  `${dateLabel(call.date, { weekday: "long", day: "numeric", month: "long" })} · ${call.shift === "DAY" ? "Jour" : "Nuit"}`;

/** La dernière proposition d'un agent sur un appel. */
const proposalOf = (state: AppState, callId: string, userId: string) =>
  state.callProposals
    .filter(p => p.callId === callId && p.userId === userId)
    .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt))[0];

/**
 * Les appels qui sollicitent l'agent (lot C). Se proposer ne l'affecte à rien :
 * ni planning, ni agenda, ni rappel ; le gestionnaire confirme. Sur un appel
 * élargi, l'agent qui n'avait pas de disponibilité validée la déclare.
 */
export function Calls() {
  const { state, actor } = useApp();
  const mine = state.callRecipients
    .filter(r => r.userId === actor.id)
    .flatMap(r => {
      const call = state.calls.find(c => c.id === r.callId);
      return call ? [{ call, circle: r.circle }] : [];
    })
    .sort((a, b) => a.call.date.localeCompare(b.call.date) || a.call.shift.localeCompare(b.call.shift));
  const open = mine.filter(m => m.call.state === "OPEN");
  const closed = mine.filter(m => m.call.state !== "OPEN").reverse();
  return (
    <>
      <PageTitle
        title="Appels"
        description="Les gardes à pourvoir pour lesquelles vous êtes sollicité. Vous proposer ne vous affecte pas : le gestionnaire confirme."
      />
      <Panel title="Gardes à pourvoir" subtitle="Les appels encore ouverts, la plus proche en tête.">
        {!open.length ? (
          <div className="empty-state">
            <Megaphone size={40} />
            <h2>Aucun appel en cours</h2>
            <p>Quand une garde manque d’un agent et que vous pouvez la prendre, l’appel arrive ici.</p>
          </div>
        ) : (
          <div className="call-list">
            {open.map(({ call, circle }) => (
              <OpenCall key={call.id} call={call} circle={circle} />
            ))}
          </div>
        )}
      </Panel>
      {closed.length > 0 && (
        <Panel title="Appels clos" subtitle="Leur issue, et celle de votre proposition.">
          <div className="call-list settled">
            {closed.slice(0, 20).map(({ call }) => {
              const proposal = proposalOf(state, call.id, actor.id);
              return (
                <article key={call.id}>
                  <CallDate call={call} />
                  <div className="call-body">
                    <strong>{slotLabel(call)}</strong>
                    {proposal && <small>Votre proposition : {proposalStates[proposal.state].toLowerCase()}</small>}
                  </div>
                  <span className="pill pill-gray">{callStates[call.state]}</span>
                </article>
              );
            })}
          </div>
        </Panel>
      )}
    </>
  );
}

function CallDate({ call }: { call: Pick<Call, "date" | "shift"> }) {
  return (
    <span className={`shift-date ${call.shift === "DAY" ? "day" : "night"}`}>
      <small>{dateLabel(call.date, { weekday: "short" })}</small>
      <strong>{Number(call.date.slice(-2))}</strong>
      <small>{dateLabel(call.date, { month: "short" })}</small>
    </span>
  );
}

function OpenCall({ call, circle }: { call: Call; circle: "AVAILABLE" | "WIDENED" }) {
  const { state, actor, run } = useApp();
  const [declared, setDeclared] = useState(false);
  const campaign = state.campaigns.find(c => c.id === call.campaignId);
  const proposal = proposalOf(state, call.id, actor.id);
  const from = campaign ? (call.shift === "DAY" ? campaign.dayStart : campaign.nightStart) : 0;
  const to = campaign ? (call.shift === "DAY" ? campaign.nightStart : campaign.dayStart) : 0;
  return (
    <article>
      <CallDate call={call} />
      <div className="call-body">
        <strong>{slotLabel(call)}</strong>
        <small>
          {call.shift === "DAY" ? <Sun size={12} /> : <Moon size={12} />}
          {campaign ? hours(campaign, call.shift) : ""} · Besoin : {callNeedText(call.need)}
        </small>
        {proposal && active(proposal) ? (
          <p className="call-status">
            <span className={`pill ${proposalPills[proposal.state]}`}>{proposalStates[proposal.state]}</span>
          </p>
        ) : (
          circle === "WIDENED" && (
            <label className="checkbox-field call-declaration">
              <input type="checkbox" checked={declared} onChange={e => setDeclared(e.target.checked)} />
              <span>{declarationText(call.date, from, to)}</span>
            </label>
          )
        )}
      </div>
      <span className="call-actions">
        {proposal && (proposal.state === "PENDING" || proposal.state === "SELECTED") ? (
          <Button size="sm" variant="secondary" onClick={() => run({ type: "withdrawProposal", callId: call.id })}>
            <X size={15} />
            Retirer ma proposition
          </Button>
        ) : proposal?.state === "CONFIRMED" ? null : (
          <Button
            size="sm"
            disabled={circle === "WIDENED" && !declared}
            onClick={() => run({ type: "proposeForCall", callId: call.id, declare: circle === "WIDENED" })}
          >
            <Check size={15} />
            Je me propose
          </Button>
        )}
      </span>
    </article>
  );
}

/** L'aperçu d'un appel, lu à l'ouverture de la fenêtre. */
type Preview = {
  need: {
    required: number;
    kept: number;
    missing_headcount: number;
    missing_qualifications: { qualification: string; missing: number }[];
  } | null;
  available: number;
  widened: number;
  open: boolean;
};

async function readCallPreview(campaignId: string, date: string, shift: Shift, withdrawalId?: string) {
  const query = new URLSearchParams({ campagne: campaignId, date, creneau: shift });
  if (withdrawalId) query.set("desistement", withdrawalId);
  try {
    const response = await fetch(`/api/appels/apercu?${query}`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as (Preview & { message?: string }) | null;
    if (!response.ok || !body) return { error: body?.message ?? "L’aperçu de l’appel n’a pas pu être lu. Réessayez." };
    return { preview: body };
  } catch {
    return { error: "La connexion a été interrompue. Réessayez." };
  }
}

/**
 * Avant de lancer un appel : la garde, le besoin restant, les qualifications
 * manquantes, et combien d'agents il atteindrait. Avec un désistement, lancer
 * l'appel l'accepte aussi — dans la même transaction.
 */
export function CallLauncher({
  campaignId,
  date,
  shift,
  withdrawalId,
  label,
  size,
}: {
  campaignId: string;
  date: string;
  shift: Shift;
  withdrawalId?: string;
  label: string;
  size?: "sm";
}) {
  const { run } = useApp();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<{ preview?: Preview; error?: string } | null>(null);
  async function show() {
    setOpen(true);
    setRead(null);
    setRead(await readCallPreview(campaignId, date, shift, withdrawalId));
  }
  const preview = read?.preview;
  const need = preview?.need;
  return (
    <>
      <Button size={size} variant="secondary" onClick={show}>
        <Megaphone size={15} />
        {label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={withdrawalId ? "Accepter et chercher un remplaçant" : "Chercher du renfort"}
        description={slotLabel({ date, shift })}
      >
        {!read && <p className="muted">Lecture de la garde…</p>}
        {read?.error && (
          <div className="warning">
            <CircleAlert size={18} />
            <span>{read.error}</span>
          </div>
        )}
        {preview && (
          <div className="month-preview">
            {!need ? (
              <p className="warning small">Les besoins de cette garde ne sont pas définis : définissez-les d’abord.</p>
            ) : (
              <>
                <p className="month-counts">
                  <strong>Besoin restant :</strong>{" "}
                  {callNeedText({
                    required: need.required,
                    kept: need.kept,
                    missingHeadcount: need.missing_headcount,
                    missingQualifications: need.missing_qualifications,
                  })}{" "}
                  — {need.kept} sur {need.required} {plural(need.required, "agent")} conservés.
                </p>
                <p>
                  {preview.available > 0
                    ? `${preview.available} ${plural(preview.available, "agent sera sollicité", "agents seront sollicités")} : leur disponibilité validée couvre la garde.`
                    : "Aucun agent n’a de disponibilité validée couvrant la garde."}{" "}
                  {preview.widened > 0 &&
                    `Vous pourrez élargir l’appel à ${preview.widened} autre${preview.widened > 1 ? "s" : ""}, qui devront confirmer leur disponibilité.`}
                </p>
                {preview.available + preview.widened === 0 && (
                  <p className="warning small">
                    Personne ne peut être sollicité : chacun est déjà affecté, sans le repos nécessaire, ou sans la
                    qualification qui manque.
                  </p>
                )}
                {withdrawalId && (
                  <p className="small muted">
                    Le désistement sera accepté et l’agent prévenu ; il sort du brouillon, et reste au planning publié
                    jusqu’à la republication.
                  </p>
                )}
              </>
            )}
            <Button
              className="full-width"
              disabled={!need || preview.open}
              onClick={async () => {
                if (await run({ type: "openCall", campaignId, date, shift, withdrawalId })) setOpen(false);
              }}
            >
              <Send size={17} />
              {preview.open
                ? "Un appel est déjà ouvert"
                : withdrawalId
                  ? "Accepter et lancer l’appel"
                  : "Lancer l’appel"}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * L'appel en cours sur une garde, vu de l'encadrement : besoin, sollicités,
 * propositions avec leurs qualifications utiles et la charge de chacun. Retenir
 * inscrit au brouillon ; « Confirmer et publier » publie la garde, ce qui ferme
 * l'appel. La base recontrôle tout à chaque geste.
 */
export function CallPanel({ call, publishable }: { call: Call; publishable: boolean }) {
  const { state, run } = useApp();
  const [confirm, confirmation] = useConfirmation();
  const recipients = state.callRecipients.filter(r => r.callId === call.id);
  const widened = recipients.filter(r => r.circle === "WIDENED").length;
  const missing = new Set(call.need.missingQualifications.map(q => q.qualification));
  const proposals = state.callProposals
    .filter(p => p.callId === call.id)
    .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));
  return (
    <Panel
      title="Appel en cours"
      subtitle={`Lancé le ${stampLabel(call.openedAt)} · besoin : ${callNeedText(call.need)} · ${recipients.length} ${plural(recipients.length, "agent sollicité", "agents sollicités")}${widened ? `, dont ${widened} après élargissement` : ""}.`}
      action={
        <span className="pill pill-orange">
          {proposals.filter(active).length} {plural(proposals.filter(active).length, "proposition")}
        </span>
      }
    >
      {!proposals.length ? (
        <div className="empty-small">
          <Users />
          <p>Aucune proposition pour l’instant.</p>
        </div>
      ) : (
        <div className="agent-card-list">
          {proposals.map(p => {
            const agent = state.agents.find(a => a.id === p.userId);
            if (!agent) return null;
            const useful = agent.qualifications.filter(q => missing.has(q));
            return (
              <div className="agent-card" key={p.id}>
                <Avatar agent={agent} />
                <div className="agent-info">
                  <strong>{agent.name}</strong>
                  <small>
                    Proposé le {stampLabel(p.proposedAt)} · {workload(state, call.campaignId, agent.id).total}{" "}
                    {plural(workload(state, call.campaignId, agent.id).total, "garde")} ce mois
                    {p.declared ? " · disponibilité déclarée" : ""}
                  </small>
                  {useful.length > 0 && (
                    <div className="qualification-tags">
                      {useful.map(q => (
                        <span key={q}>{q}</span>
                      ))}
                    </div>
                  )}
                  <span className={`pill ${proposalPills[p.state]}`}>{proposalStates[p.state].split(" — ")[0]}</span>
                </div>
                {p.state === "PENDING" && (
                  <Button
                    size="icon"
                    variant="secondary"
                    aria-label={`Retenir ${agent.name}`}
                    onClick={() => run({ type: "selectProposal", proposalId: p.id })}
                  >
                    <UserPlus size={17} />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="call-manager-actions">
        <Button
          className="full-width"
          disabled={!publishable}
          onClick={() =>
            confirm({
              title: "Confirmer et publier ?",
              description:
                "La garde est publiée avec l’équipe du brouillon ; les agents retenus et l’équipe sont prévenus, l’appel se ferme et les autres candidats apprennent que la recherche est terminée.",
              confirmLabel: "Confirmer et publier",
              onConfirm: () => run({ type: "confirmCall", callId: call.id }),
            })
          }
        >
          <Send size={16} />
          Confirmer et publier
        </Button>
        {!publishable && (
          <p className="small muted">
            Retenez assez d’agents pour couvrir le besoin : la garde ne peut pas être publiée incomplète.
          </p>
        )}
        {!call.widenedAt && (
          <Button
            variant="secondary"
            className="full-width"
            onClick={() => run({ type: "widenCall", callId: call.id })}
          >
            <Users size={16} />
            Élargir aux agents sans disponibilité validée
          </Button>
        )}
        <Button
          variant="ghost"
          className="full-width"
          onClick={() =>
            confirm({
              title: "Annuler l’appel ?",
              description:
                "Les candidats sont prévenus que la recherche est terminée ; les sollicitations encore en attente ne partent plus.",
              confirmLabel: "Annuler l’appel",
              danger: true,
              onConfirm: () => run({ type: "cancelCall", callId: call.id }),
            })
          }
        >
          <X size={16} />
          Annuler l’appel
        </Button>
      </div>
      {confirmation}
    </Panel>
  );
}
