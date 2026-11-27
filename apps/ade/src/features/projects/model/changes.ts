import { failureCode } from "../../../ports";
import { type Repository, reloadWorkspaces, useWorkspaceStore } from "../../workspaces/model";
import { bytesOf, keepMark, type ProjectDependencies } from "./controller";
import { useProjectStore } from "./store";

// The project changes (Lervo ADE projects, "The switcher"), loaded when the person first asks for
// one, so they stay out of the start screen's bundle (ADE performance, bundle budget).

/**
 * Runs one project change, records its failure code, and reloads the lists after it (ADE craft
 * rules, 22). `shown` changes the listed projects before the core answers, so a renamed project
 * never shows its old name again; a refusal reloads them, which undoes it.
 */
async function change<T>(
  dependencies: ProjectDependencies,
  run: () => Promise<T>,
  shown?: (repositories: readonly Repository[]) => readonly Repository[],
): Promise<T | null> {
  useProjectStore.setState({ failure: null });
  if (shown !== undefined)
    useWorkspaceStore.setState({ repositories: shown(useWorkspaceStore.getState().repositories) });
  let result: T | null = null;
  try {
    result = await run();
  } catch (failure) {
    useProjectStore.setState({ failure: failureCode(failure) });
  }
  await reloadWorkspaces(dependencies.commands, dependencies.lists).catch(() => undefined);
  return result;
}

/** The listed projects with one of them changed. */
const withProject =
  (projectId: string, changed: Partial<Repository>) => (repositories: readonly Repository[]) =>
    repositories.map((item) => (item.projectId === projectId ? { ...item, ...changed } : item));

export async function renameProject(
  dependencies: ProjectDependencies,
  projectId: string,
  name: string,
): Promise<void> {
  useProjectStore.setState({ renaming: null });
  await change(
    dependencies,
    () => dependencies.commands.run("project.rename", { projectId, name }),
    withProject(projectId, { displayName: name }),
  );
}

/** Opens the image panel and sets the chosen image as the project's mark. */
export async function chooseMark(
  dependencies: ProjectDependencies,
  projectId: string,
  title: string,
): Promise<void> {
  const path = await dependencies.choosers.image(title);
  if (path === null) return;
  await change(dependencies, async () => {
    const data = await dependencies.images.prepareMark(await dependencies.files.readImage(path));
    const { mark } = await dependencies.commands.run("project.mark.set", { projectId, data });
    // The thumbnail comes from the prepared bytes, so the new mark shows without reading it back.
    await keepMark(dependencies, mark.sha256, new Blob([bytesOf(data)], { type: mark.mediaType }));
  });
}

export async function clearMark(dependencies: ProjectDependencies, projectId: string) {
  await change(
    dependencies,
    () => dependencies.commands.run("project.mark.clear", { projectId }),
    withProject(projectId, { mark: null }),
  );
}

/** Removes the project from this host's list. Its files stay where they are. */
export async function removeProject(dependencies: ProjectDependencies, projectId: string) {
  await change(
    dependencies,
    () => dependencies.commands.run("project.unregister", { projectId }),
    (repositories) => repositories.filter((item) => item.projectId !== projectId),
  );
}
