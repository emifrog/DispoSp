"use client";
import { useState } from "react";
import { CalendarSync, Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useApp } from "./provider";
import { Panel } from "./common";
import { Button } from "./ui/button";
import { useConfirmation } from "./ui/confirm";
import { stampLabel } from "@/lib/domain";

/**
 * L'abonnement de l'agent à son agenda (lot D).
 *
 * L'adresse est montrée une seule fois, à sa création : la base n'en garde que
 * le condensat, personne ne peut la relire. Perdue, elle se remplace — et
 * l'ancienne cesse de fonctionner. Le panneau dit aussi ce que l'abonnement ne
 * fait pas : il suit le rythme du logiciel d'agenda, et ne remplace ni les
 * notifications ni le rappel de garde de DispoSP.
 */
export function CalendarSubscription() {
  const { state, reload, notice } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmation] = useConfirmation();
  const feed = state.calendarFeed;

  async function create() {
    const response = await fetch("/api/agenda", { method: "POST" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { url?: string; message?: string } | null;
    if (!response?.ok || !body?.url) {
      setError(body?.message ?? "L’adresse d’abonnement n’a pas pu être créée. Réessayez.");
      return;
    }
    setError(null);
    setUrl(body.url);
    reload();
  }
  async function revoke() {
    const response = await fetch("/api/agenda", { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      setError("L’abonnement n’a pas pu être révoqué. Réessayez.");
      return;
    }
    setError(null);
    setUrl(null);
    notice("Abonnement révoqué : l’adresse ne lit plus rien.");
    reload();
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notice("Adresse copiée.");
    } catch {
      setError("La copie n’a pas fonctionné : sélectionnez l’adresse et copiez-la à la main.");
    }
  }

  return (
    <Panel
      title="M’abonner à mon agenda"
      subtitle="Vos gardes publiées, dans Google Agenda, Apple Calendrier ou Outlook, mises à jour sans rien réimporter."
    >
      <div className="calendar-subscription">
        {error && (
          <p className="warning small" role="alert">
            {error}
          </p>
        )}
        {url ? (
          <>
            <p>
              <strong>Votre adresse privée.</strong> Elle ne s’affichera plus : ajoutez-la maintenant à votre agenda.
              Quiconque la possède peut lire vos gardes ; ne la partagez pas.
            </p>
            <div className="calendar-url">
              <input readOnly value={url} aria-label="Adresse d’abonnement" onFocus={e => e.target.select()} />
              <Button size="sm" variant="secondary" onClick={() => copy(url)}>
                <Copy size={15} />
                Copier
              </Button>
            </div>
            <ul className="calendar-steps">
              <li>
                <strong>iPhone, iPad, Mac</strong> —{" "}
                <a href={url.replace(/^https?:/, "webcal:")}>
                  <Link2 size={13} />
                  ouvrir dans Calendrier
                </a>
                , puis « S’abonner ».
              </li>
              <li>
                <strong>Google Agenda</strong> — sur ordinateur : Autres agendas, « + », « À partir de l’URL », collez
                l’adresse. L’agenda apparaît ensuite sur le téléphone.
              </li>
              <li>
                <strong>Outlook</strong> — Ajouter un calendrier, « S’abonner à partir du web », collez l’adresse.
              </li>
            </ul>
          </>
        ) : feed ? (
          <p>
            <strong>Abonnement actif</strong> depuis le {stampLabel(feed.createdAt)}.{" "}
            {feed.lastReadAt
              ? `Dernière lecture par votre agenda : ${stampLabel(feed.lastReadAt)}.`
              : "Votre agenda ne l’a pas encore lu."}{" "}
            L’adresse n’est plus affichable : si vous l’avez perdue, créez-en une nouvelle.
          </p>
        ) : (
          <p>
            Une adresse privée, à ajouter une fois à votre logiciel d’agenda : vos gardes publiées y apparaissent, et
            leurs changements suivent. Les brouillons et les propositions n’y figurent pas.
          </p>
        )}
        <p className="small muted">
          Votre agenda relit l’adresse à son propre rythme — de quelques minutes à un jour selon le logiciel. Une
          modification urgente vous parvient d’abord par les notifications de DispoSP, qui envoient aussi le rappel de
          garde : l’agenda ne le remplace pas.
        </p>
        <div className="calendar-actions">
          {!feed && !url ? (
            <Button onClick={create}>
              <CalendarSync size={16} />
              Créer mon adresse d’abonnement
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  confirm({
                    title: "Créer une nouvelle adresse ?",
                    description:
                      "L’adresse actuelle cessera de fonctionner : remplacez l’abonnement dans votre logiciel d’agenda par la nouvelle.",
                    confirmLabel: "Créer une nouvelle adresse",
                    onConfirm: create,
                  })
                }
              >
                <RefreshCw size={16} />
                Nouvelle adresse
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  confirm({
                    title: "Révoquer l’abonnement ?",
                    description:
                      "L’adresse cesse de fonctionner tout de suite. Votre agenda gardera peut-être les gardes déjà lues : supprimez l’abonnement de votre logiciel d’agenda.",
                    confirmLabel: "Révoquer",
                    danger: true,
                    onConfirm: revoke,
                  })
                }
              >
                <Trash2 size={16} />
                Révoquer
              </Button>
            </>
          )}
        </div>
      </div>
      {confirmation}
    </Panel>
  );
}
