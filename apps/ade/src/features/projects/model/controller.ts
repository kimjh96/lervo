import {
  type ApplicationCommands,
  type Choosers,
  type Files,
  type Images,
  type ListCache,
  type ProjectMemory,
} from "../../../ports";
import { useWorkspaceStore } from "../../workspaces";
import { useProjectStore } from "./store";

/** The adapters the project actions use. */
export interface ProjectDependencies {
  readonly commands: ApplicationCommands;
  readonly lists: ListCache;
  readonly memory: ProjectMemory;
  readonly images: Images;
  readonly files: Files;
  readonly choosers: Choosers;
}

/** The side of a kept mark thumbnail: twice the largest mark, for sharp edges on Retina. */
const THUMBNAIL_SIDE = 64;

/** Shows the project and marks kept from the last launch. */
export function restoreProjects(memory: ProjectMemory): void {
  useProjectStore.setState({ selected: memory.selected(), marks: memory.marks() });
}

/**
 * Selects a project. The open workspace stays when it belongs to it; otherwise the start screen
 * of the project shows.
 */
export function selectProject(memory: ProjectMemory, projectId: string): void {
  memory.select(projectId);
  useProjectStore.setState({ selected: projectId, expanded: false, sheet: null });
  const workspaces = useWorkspaceStore.getState();
  const open = workspaces.workspaces.find((item) => item.workspaceId === workspaces.selected);
  if (open !== undefined && open.projectId !== projectId) workspaces.select(null);
}

/**
 * Opens the "Clone Repository" or "New Project" window, which adds a project and starts no work
 * (Lervo ADE projects, "Adding a project").
 */
export function openProjectSheet(kind: "clone" | "new"): void {
  useProjectStore.setState({ sheet: kind, expanded: false });
}

/** Closes the "Clone Repository" or "New Project" window. */
export function closeProjectSheet(): void {
  if (useProjectStore.getState().sheet !== null) useProjectStore.setState({ sheet: null });
}

export function bytesOf(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Keeps a mark's thumbnail by its image's hash, for a project's mark or an agent's image alike,
 * so the mark shows at once on the next launch.
 */
export async function keepMark(
  dependencies: Pick<ProjectDependencies, "images" | "memory">,
  sha256: string,
  image: Blob,
): Promise<void> {
  const url = await dependencies.images.thumbnail(image, THUMBNAIL_SIDE);
  dependencies.memory.keepMark(sha256, url);
  useProjectStore.setState((store) => ({ marks: { ...store.marks, [sha256]: url } }));
}

const reading = new Set<string>();

/**
 * Reads the image of each listed mark the ADE has not kept yet, one at a time. A mark that cannot
 * be read shows the first letter until the next list.
 */
export async function refreshMarks(dependencies: ProjectDependencies): Promise<void> {
  const { repositories, advertisedCommands } = useWorkspaceStore.getState();
  if (!advertisedCommands?.includes("project.mark.read")) return;
  for (const repository of repositories) {
    const mark = repository.mark;
    if (mark === null || mark === undefined) continue;
    if (useProjectStore.getState().marks[mark.sha256] !== undefined || reading.has(mark.sha256))
      continue;
    reading.add(mark.sha256);
    try {
      const { image } = await dependencies.commands.run("project.mark.read", {
        projectId: repository.projectId,
      });
      if (image !== null)
        await keepMark(
          dependencies,
          image.sha256,
          new Blob([bytesOf(image.data)], { type: image.mediaType }),
        );
    } catch {
      // The first letter stays; the next list tries again.
    } finally {
      reading.delete(mark.sha256);
    }
  }
}

/**
 * Keeps the project marks current: it reads the marks of each new list. Returns the unsubscribe
 * function.
 */
export function bindProjects(dependencies: ProjectDependencies): () => void {
  void refreshMarks(dependencies);
  return useWorkspaceStore.subscribe((store, previous) => {
    if (
      store.repositories !== previous.repositories ||
      store.advertisedCommands !== previous.advertisedCommands
    )
      void refreshMarks(dependencies);
  });
}
