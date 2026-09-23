"use client";
import Link from "next/link";
import { ArrowRight, Check, CircleAlert, Inbox, Moon, Sun, X } from "lucide-react";
import { useApp } from "./provider";
import { AdministrationOnly, Avatar, PageTitle, Panel } from "./common";
import { Button } from "./ui/button";
import { dateLabel, hours, plural, shiftKey, type AppState } from "@/lib/domain";
import { CAMPAIGN_PARAM } from "@/lib/campaign-param";

type Withdrawal = AppState["withdrawals"][number];

const stateLabels: Record<Withdrawal["state"], string> = {
  PENDING: "En attente",
  ACCEPTED: "Accepté",
  REFUSED: "Refusé",
  CANCELLED: "Retiré",
};
const statePills: Record<Withdrawal["state"], string> = {
  PENDING: "pill-orange",
  ACCEPTED: "pill-green",
  REFUSED: "pill-red",
  CANCELLED: "pill-gray",
};

/**
 * Les désistements du centre.
 *
 * Trancher ne réaffecte pas : la base refuse de republier un créneau dont
 * l'effectif n'est plus couvert, et il n'existe qu'une façon de modifier un
 * planning — l'écran de planning. Accepter dit « c'est entendu, vous n'êtes
 * plus attendu » ; remplacer reste un geste distinct, et l'écran le rappelle
 * tant que l'agent figure encore dans la révision publiée.
 */
export function Withdrawals() {
  const { state, canAdminister, run } = useApp();
  if (!canAdminister) return <AdministrationOnly title="Demandes des agents" />;

  const byDate = (a: Withdrawal, b: Withdrawal) => a.date.localeCompare(b.date);
  const pending = state.withdrawals.filter(w => w.state === "PENDING").sort(byDate);
  const settled = state.withdrawals.filter(w => w.state !== "PENDING").sort((a, b) => byDate(b, a));

  return (
    <>
      <PageTitle
        title="Demandes des agents"
        description="Désistements sur les gardes publiées. Trancher répond à l’agent ; réaffecter se fait au planning."
      />

      <Panel
        title="En attente"
        subtitle="Chacune attend une réponse, et chaque acceptation laisse une place à reprendre."
        action={
          pending.length ? (
            <span className="pill pill-orange">
              {pending.length} {plural(pending.length, "demande")}
            </span>
          ) : undefined
        }
      >
        {!pending.length ? (
          <div className="empty-state">
            <Inbox size={40} />
            <h2>Aucune demande en attente</h2>
            <p>Les désistements signalés par les agents apparaîtront ici.</p>
          </div>
        ) : (
          <div className="withdrawal-list">
            {pending.map(w => (
              <Row key={w.id} withdrawal={w} state={state} run={run} />
            ))}
          </div>
        )}
      </Panel>

      {settled.length > 0 && (
        <Panel title="Déjà tranchées" subtitle="Les demandes closes, les plus récentes en tête.">
          <div className="withdrawal-list settled">
            {settled.slice(0, 20).map(w => (
              <Row key={w.id} withdrawal={w} state={state} run={run} />
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function Row({
  withdrawal,
  state,
  run,
}: {
  withdrawal: Withdrawal;
  state: AppState;
  run: ReturnType<typeof useApp>["run"];
}) {
  const agent =
    state.agents.find(a => a.id === withdrawal.userId) ?? state.inactiveAgents.find(a => a.id === withdrawal.userId);
  const campaign = state.campaigns.find(c => c.id === withdrawal.campaignId);
  const published = state.publications[shiftKey(withdrawal.campaignId, withdrawal.date, withdrawal.shift)];
  // Accepté mais toujours au planning publié : le remplacement reste à faire,
  // et c'est la seule chose que cet écran ne peut pas faire lui-même.
  const stillOn = withdrawal.state === "ACCEPTED" && published?.agents.includes(withdrawal.userId);

  return (
    <article>
      <span className={`shift-date ${withdrawal.shift === "DAY" ? "day" : "night"}`}>
        <small>{dateLabel(withdrawal.date, { weekday: "short" })}</small>
        <strong>{Number(withdrawal.date.slice(-2))}</strong>
        <small>{dateLabel(withdrawal.date, { month: "short" })}</small>
      </span>
      <div className="withdrawal-body">
        <span className="withdrawal-who">
          {agent && <Avatar agent={agent} />}
          <span>
            <strong>{agent?.name ?? "Agent retiré du centre"}</strong>
            <small>
              {withdrawal.shift === "DAY" ? <Sun size={12} /> : <Moon size={12} />}
              Garde {withdrawal.shift === "DAY" ? "de jour" : "de nuit"}
              {campaign ? ` · ${hours(campaign, withdrawal.shift)}` : ""}
            </small>
          </span>
        </span>
        <p className="withdrawal-reason">{withdrawal.reason || "Aucun motif indiqué."}</p>
        {stillOn && (
          <p className="withdrawal-todo">
            <CircleAlert size={15} />
            Toujours au planning publié — le remplacement reste à faire.
            {/* La campagne de la garde, et non celle du sélecteur : sans elle, le
                Planning ouvrait le premier jour du mois sélectionné. */}
            <Link
              href={`/planning?${CAMPAIGN_PARAM}=${withdrawal.campaignId}&date=${withdrawal.date}&shift=${withdrawal.shift}`}
            >
              Ouvrir la garde
              <ArrowRight size={14} />
            </Link>
          </p>
        )}
      </div>
      {withdrawal.state === "PENDING" ? (
        <span className="withdrawal-actions">
          <Button
            size="sm"
            onClick={() => run({ type: "decideWithdrawal", withdrawalId: withdrawal.id, accepted: true })}
          >
            <Check size={15} />
            Accepter
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => run({ type: "decideWithdrawal", withdrawalId: withdrawal.id, accepted: false })}
          >
            <X size={15} />
            Refuser
          </Button>
        </span>
      ) : (
        <span className={`pill ${statePills[withdrawal.state]}`}>{stateLabels[withdrawal.state]}</span>
      )}
    </article>
  );
}
