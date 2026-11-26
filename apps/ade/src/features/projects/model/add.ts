import { create } from "zustand";

import {
  type ApplicationCommands,
  type Choosers,
  failureCode,
  type ListCache,
  type ProjectMemory,
} from "../../../ports";
import { reloadWorkspaces } from "../../workspaces";
import { selectProject } from "./controller";
import type { ProjectSource } from "./sources";

/** The adapters adding a project uses. */
export interface AddDependencies {
  readonly commands: ApplicationCommands;
  readonly lists: ListCache;
  readonly memory: ProjectMemory;
  readonly choosers: Choosers;
}

interface AddStore {
  /** Where clones and new projects go, once the core answered. */
  readonly location: string | null;
  /** What the core is adding now, if anything. */
  readonly adding: "folder" | "clone" | "new" | null;
  /** The code of the last add that failed, until the next try. */
  readonly failure: string | null;
}

export const useAddStore = create<AddStore>(() => ({
  location: null,
  adding: null,
  failure: null,
}));

/** Reads the projects location, so a clone or a new project shows where it goes. */
export async function readLocation(commands: ApplicationCommands): Promise<void> {
  const { path } = await commands.run("projects.location", {});
  useAddStore.setState({ location: path });
}

/** Opens the folder panel and keeps the chosen folder as the projects location. */
export async function chooseLocation(dependencies: AddDependencies, title: string) {
  const path = await dependencies.choosers.folder(title);
  if (path === null) return;
  try {
    const result = await dependencies.commands.run("projects.location", { path });
    useAddStore.setState({ location: result.path, failure: null });
  } catch (failure) {
    useAddStore.setState({ failure: failureCode(failure) });
  }
}

/** Forgets a failure the person turned away from. */
export function clearAddFailure(): void {
  if (useAddStore.getState().failure !== null) useAddStore.setState({ failure: null });
}

/**
 * Adds a project, reloads the lists, and selects it, so the switcher shows it at once. Returns its
 * ID and manifest name, or null after recording the failure's code.
 */
async function add(
  dependencies: AddDependencies,
  adding: NonNullable<AddStore["adding"]>,
  arguments_: Record<string, unknown>,
): Promise<{ projectId: string; name: string } | null> {
  useAddStore.setState({ adding, failure: null });
  try {
    const added = await dependencies.commands.run("project.add", arguments_);
    await reloadWorkspaces(dependencies.commands, dependencies.lists).catch(() => undefined);
    selectProject(dependencies.memory, added.projectId);
    return { projectId: added.projectId, name: added.name };
  } catch (failure) {
    useAddStore.setState({ failure: failureCode(failure) });
    return null;
  } finally {
    useAddStore.setState({ adding: null });
  }
}

/** Adds a folder the person dropped or chose as a project. */
export function addFolder(dependencies: AddDependencies, path: string) {
  return add(dependencies, "folder", { source: "folder", path });
}

/** Clones a link, or creates a new project, in the projects location. */
export function addFromSource(dependencies: AddDependencies, source: ProjectSource) {
  const into = useAddStore.getState().location;
  const location = into === null ? {} : { into };
  return source.kind === "clone"
    ? add(dependencies, "clone", { source: "clone", url: source.url, ...location })
    : add(dependencies, "new", { source: "new", name: source.name, ...location });
}
