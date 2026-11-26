import type { Repository, Workspace } from "../../workspaces/model";
import { visibleStatus } from "../../workspaces/model";

type Statuses = Readonly<Record<string, Parameters<typeof visibleStatus>[0]>>;

/** The selected project, or the first listed one when the selection is not listed. */
export function currentProject(
  repositories: readonly Repository[],
  selected: string | null,
): Repository | null {
  return repositories.find((item) => item.projectId === selected) ?? repositories[0] ?? null;
}

/** The name a project shows: its display name, or the manifest's from an older core. */
export const projectName = (repository: Repository): string =>
  repository.displayName ?? repository.name;

/** The projects with a workspace that needs the owner. */
export function projectsNeedingYou(
  workspaces: readonly Workspace[],
  statuses: Statuses,
): ReadonlySet<string> {
  return new Set(
    workspaces
      .filter((workspace) => visibleStatus(statuses[workspace.sessionId]) === "needsYou")
      .map((workspace) => workspace.projectId),
  );
}

/** The project `⌘1` to `⌘9` selects, in list order. */
export function shortcutProject(
  repositories: readonly Repository[],
  key: string,
): Repository | undefined {
  if (!/^[1-9]$/u.test(key)) return undefined;
  return repositories[Number(key) - 1];
}

/** Whether the core answers project commands; an older core only lists projects. */
export const managesProjects = (advertised: readonly string[] | null): boolean =>
  advertised?.includes("project.rename") === true;
