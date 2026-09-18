import type { ReactNode } from "react";
import { type Agent, type Availability, labels } from "@/lib/domain";
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
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
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
