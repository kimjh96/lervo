import { failureCode } from "../../../ports";
import { reloadWorkspaces } from "../../workspaces";
import { bytesOf, keepMark, type ProjectDependencies } from "./controller";
import { useProjectStore } from "./store";

// The project changes (Lervo ADE projects, "The switcher"), loaded when the person first asks for
// one, so they stay out of the start screen's bundle (ADE performance, bundle budget).

/** Runs one project change, records its failure code, and reloads the lists after it. */
async function change<T>(
  dependencies: ProjectDependencies,
  run: () => Promise<T>,
): Promise<T | null> {
  useProjectStore.setState({ failure: null });
  let result: T;
  try {
    result = await run();
  } catch (failure) {
    useProjectStore.setState({ failure: failureCode(failure) });
    return null;
  }
  await reloadWorkspaces(dependencies.commands, dependencies.lists).catch(() => undefined);
  return result;
}

export async function renameProject(
  dependencies: ProjectDependencies,
  projectId: string,
  name: string,
): Promise<void> {
  useProjectStore.setState({ renaming: null });
  await change(dependencies, () =>
    dependencies.commands.run("project.rename", { projectId, name }),
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
  await change(dependencies, () => dependencies.commands.run("project.mark.clear", { projectId }));
}

/** Removes the project from this host's list. Its files stay where they are. */
export async function removeProject(dependencies: ProjectDependencies, projectId: string) {
  await change(dependencies, () => dependencies.commands.run("project.unregister", { projectId }));
}
