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

/** The status a workspace shows: only working and needs-you have a color (visual language). */
export function visibleStatus(status: SessionStatus | undefined): "working" | "needsYou" | null {
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
