import type { ReactNode } from "react";
import { ShieldCheck, type LucideIcon } from "lucide-react";
import { type Agent, type Availability, gradeLabel, labels } from "@/lib/domain";

/**
 * Le grade, puis la fonction quand elle est renseignée.
 *
 * La fiche les distingue — le grade suit la personne, la fonction se tient sur
 * un engin —, mais aucun écran ne montrait la fonction : saisie, elle
 * disparaissait. Elle se lit désormais partout où le grade se lit.
 */
export const gradeAndFonction = (agent: Agent) => [gradeLabel(agent), agent.fonction].filter(Boolean).join(" · ");

/**
 * L'anneau de progression de la maquette.
 *
 * Un `conic-gradient` plutôt qu'un SVG : rien à calculer, pas de circonférence
 * ni de `stroke-dasharray`, et le trou central reçoit du texte sans masque.
 * L'arc part de midi et tourne dans le sens des aiguilles, comme sur la
 * maquette — le `rotate(-90deg)` de l'ancien anneau du tableau de bord le
 * faisait partir de neuf heures.
 */
export function ProgressRing({
  percent,
  label,
  caption,
  size = "lg",
  tone = "blue",
}: {
  percent: number;
  /** Le contenu central. Par défaut le pourcentage lui-même. */
  label?: ReactNode;
  caption?: string;
  size?: "sm" | "md" | "lg";
  tone?: "blue" | "green";
}) {
  // Une couverture peut dépasser le besoin, et un mois peut n'avoir aucun jour
  // à renseigner : l'anneau borne, il ne juge pas.
  const share = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
  return (
    <div
      className={`ring ring-${size} ring-${tone}`}
      style={{ "--ring-share": `${share}%` } as React.CSSProperties}
      role="img"
      aria-label={caption ? `${share} % — ${caption}` : `${share} %`}
    >
      <div>
        <strong>
          {label ?? (
            <>
              {share}
              <small>%</small>
            </>
          )}
        </strong>
        {caption && <span>{caption}</span>}
      </div>
    </div>
  );
}

/**
 * Le sélecteur segmenté, en deux tailles.
 *
 * `sm` est celui des barres d'outils, déjà présent sur trois écrans ; `lg` est
 * celui que la maquette utilise en tête de page, plus haut et porteur d'icônes.
 * Des boutons plutôt qu'un `role="tablist"` : ils ne commandent pas des
 * panneaux frères mais le contenu de la page entière, et l'ARIA de tablist
 * promettrait une navigation au clavier entre onglets qui n'aurait pas de sens.
 */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "sm",
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  label: string;
  size?: "sm" | "lg";
}) {
  return (
    <div className={`segmented segmented-${size}`} role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={value === option.value ? "selected" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <option.icon size={size === "lg" ? 17 : 14} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function PageTitle({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
export function Panel({
  id,
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  /** Pour qu'un lien venu d'un autre écran puisse viser ce panneau. */
  id?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
/**
 * L'indicateur d'attente.
 *
 * Un SVG animé par CSS plutôt qu'une icône de la bibliothèque : la rotation
 * doit s'arrêter pour qui a demandé moins d'animations, et une règle CSS sait
 * le faire — un composant qui tourne tout seul, non.
 *
 * `aria-hidden` : il ne dit rien qu'un lecteur d'écran doive entendre. C'est le
 * texte à côté qui porte le sens, et c'est lui qu'on annonce.
 */
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** L'écran d'attente d'une navigation : il occupe la place plutôt que de la
    laisser vide, pour que rien ne saute quand le contenu arrive. */
export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <Spinner size={28} />
      <p>{label}</p>
    </div>
  );
}

/** Un écran que seule l'administration peut lire. La base le dit aussi — ses
    policies ne renvoient rien aux autres — mais une page vide n'explique rien. */
export function AdministrationOnly({ title }: { title: string }) {
  return (
    <>
      <PageTitle title={title} description="Cet écran est réservé à l’administration du centre." />
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
export function Avatar({ agent }: { agent: Agent }) {
  return (
    <span className={`avatar avatar-${agent.name.length % 4}`}>
      {agent.name
        .split(" ")
        .map(n => n[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
export function StatusBadge({ value }: { value?: Availability }) {
  return (
    <span
      className={`status-cell ${value ? labels[value].className : "unknown"}`}
      title={value ? labels[value].label : "Non renseigné"}
    >
      {value ? labels[value].short : "?"}
    </span>
  );
}
export function Legend() {
  return (
    <div className="legend">
      {Object.entries(labels).map(([key, label]) => (
        <span key={key}>
          <i className={label.className} />
          {label.short} · {label.label}
        </span>
      ))}
      <span>
        <i className="unknown" />? · Non renseigné
      </span>
    </div>
  );
}
