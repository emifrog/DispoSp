// Types and labels only: this module is imported by client components, so it
// must never reach next/headers. The reading lives in session.server.ts.
export type Membership = {
  organizationId: string;
  organizationName: string;
  teamId: string;
  teamName: string;
  role: string;
};
export type Session = {
  userId: string;
  email: string;
  displayName: string;
  /** null when the account exists but no one has attached it to an organization yet. */
  membership: Membership | null;
};
/** A session the workspace can actually render: the layout narrows to this. */
export type AttachedSession = Session & { membership: Membership };

export const roleLabels: Record<string, string> = {
  AGENT: "Agent",
  RESPONSABLE: "Responsable d’équipe",
  GESTIONNAIRE: "Gestionnaire",
  ADMIN: "Administrateur",
};
