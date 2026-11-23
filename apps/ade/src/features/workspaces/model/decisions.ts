import type { SessionStatus, Workspace } from "./types";

/** Workspaces grouped by repository, repositories by name, each group newest first. */
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
      workspaces: group.sort((left, right) => right.preparedAt.localeCompare(left.preparedAt)),
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
