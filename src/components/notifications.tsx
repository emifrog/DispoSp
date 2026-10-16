"use client";
import Link from "next/link";
import { ArrowRight, Bell, BellRing, Check, Inbox } from "lucide-react";
import { useApp } from "./provider";
import { PageTitle, Panel } from "./common";
import { PushNotifications } from "./pwa";
import { Button } from "./ui/button";
import { notificationLabels, notificationTargets, plural, stampLabel } from "@/lib/domain";

export function Notifications() {
  const { state, run } = useApp();
  const unread = state.notifications.filter(n => !n.readAt);
  return (
    <>
      <PageTitle
        title="Notifications"
        description="Ouvertures de campagne, rappels, plannings publiés et désistements : chaque message mène à l’écran où agir."
        action={
          unread.length ? (
            <Button variant="secondary" onClick={() => run({ type: "readNotifications", ids: unread.map(n => n.id) })}>
              <Check size={16} />
              Tout marquer comme lu
            </Button>
          ) : undefined
        }
      />
      <Panel
        title="Messages reçus"
        subtitle={
          unread.length
            ? `${unread.length} ${plural(unread.length, "message")} non ${plural(unread.length, "lu")}`
            : "Tout est lu."
        }
      >
        {!state.notifications.length ? (
          <div className="empty-small notice-empty">
            <Inbox />
            <p>Aucune notification pour le moment.</p>
          </div>
        ) : (
          <ol className="notice-list">
            {state.notifications.map(notice => {
              // Le message n'était qu'un texte à marquer comme lu, et la
              // notification du téléphone, qui mène ici, s'y arrêtait : chacun
              // porte désormais le lien de son email. L'ouvrir vaut lecture.
              const target = notificationTargets[notice.kind];
              const open = () => {
                if (!notice.readAt) void run({ type: "readNotifications", ids: [notice.id] });
              };
              return (
                <li key={notice.id} className={notice.readAt ? "" : "unread"}>
                  <span className="notice-icon">{notice.readAt ? <Bell size={18} /> : <BellRing size={18} />}</span>
                  <div>
                    <h3>{notice.subject}</h3>
                    {notice.body && <p>{notice.body}</p>}
                    <small>
                      {notificationLabels[notice.kind] ?? notice.kind} · {stampLabel(notice.createdAt)}
                    </small>
                    {target && (
                      <Link className="notice-action" href={target.path} onClick={open}>
                        {target.label}
                        <ArrowRight size={14} />
                      </Link>
                    )}
                  </div>
                  {!notice.readAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run({ type: "readNotifications", ids: [notice.id] })}
                    >
                      Marquer comme lu
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
      {/* Le même panneau que sur le profil, et pour cause : c'est ici qu'on se
          demande pourquoi rien n'arrive sur son téléphone. */}
      <PushNotifications />
    </>
  );
}
