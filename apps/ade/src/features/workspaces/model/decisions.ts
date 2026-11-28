import type { SessionStatus, Workspace } from "./types";

/**
 * Workspaces grouped by repository, repositories by name. Each group keeps the core's order, latest
 * activity first, in which opening a conversation never moves it (Lervo ADE core link).
 */
export function groupByRepository(
  workspaces: readonly Workspace[],
): { repositoryName: string; workspaces: Workspace[] }[] {
  const groups = new Map<string, Workspace[]>();
  for (const workspace of workspaces) {
    const group = groups.get(workspace.repositoryName) ?? [];
    group.push(workspace);
    groups.set(workspace.repositoryName, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repositoryName, group]) => ({
      repositoryName,
      workspaces: group,
    }));
}

/**
 * The workspaces that arrived with a reload: those absent from the previous list. The first load
 * brings history, not arrivals, so nothing arrives then (ADE motion, "Live changes move").
 */
export function arrivals(
  previous: readonly Workspace[] | null,
  next: readonly Workspace[],
): ReadonlySet<string> {
  if (previous === null) return new Set();
  const known = new Set(previous.map((workspace) => workspace.workspaceId));
  return new Set(
    next.map((workspace) => workspace.workspaceId).filter((workspaceId) => !known.has(workspaceId)),
  );
}

/** A status that shows on a workspace: only working and needs-you have a color. */
export type VisibleStatus = "working" | "needsYou";

/** The status a workspace shows (visual language, "Color"), if any. */
export function visibleStatus(status: SessionStatus | undefined): VisibleStatus | null {
  if (status === "working" || status === "starting") return "working";
  if (status === "needs_user") return "needsYou";
  return null;
}

/** A conversation's sessions with their agents: every participant's, or the lead's alone. */
export function sessionsOf(
  workspace: Workspace,
): readonly { readonly agentId: string | undefined; readonly sessionId: string }[] {
  // An older core names only the lead's session.
  return workspace.sessions ?? [{ agentId: workspace.agentId, sessionId: workspace.sessionId }];
}

/**
 * The status a conversation shows, from every agent's session in it: it needs the owner when any
 * of them does, and works when any works, so an agent that joined shows its work as the lead's does.
 */
export function workspaceStatus(
  workspace: Workspace,
  statuses: Readonly<Record<string, SessionStatus | undefined>>,
): VisibleStatus | null {
  let shown: VisibleStatus | null = null;
  for (const session of sessionsOf(workspace)) {
    const status = visibleStatus(statuses[session.sessionId]);
    if (status === "needsYou") return status;
    if (status === "working") shown = status;
  }
  return shown;
}

/** Whether the session host runs the session, as its last status says; no status counts as not. */
export function isRunning(status: SessionStatus | undefined): boolean {
  return status !== undefined && status !== "ended";
}

export type NotificationKind = "needsYou" | "finished";

/**
 * Whether a status change deserves a desktop notification: the agent needs the user, or it
 * finished its turn. Nothing notifies while the user looks at that workspace.
 */
export function notificationFor(
  previous: SessionStatus | undefined,
  next: SessionStatus,
  watched: boolean,
): NotificationKind | null {
  if (watched || previous === next || previous === undefined) return null;
  if (next === "needs_user") return "needsYou";
  if (previous === "working" && next === "idle") return "finished";
  return null;
}
