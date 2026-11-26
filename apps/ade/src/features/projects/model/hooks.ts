import {
  useApplicationCommands,
  useChoosers,
  useFiles,
  useImages,
  useListCache,
  useProjectMemory,
} from "../../../ports";
import { useWorkspaceStore } from "../../workspaces/model";
import type { AddDependencies } from "./add";
import type { ProjectDependencies } from "./controller";
import { currentProject } from "./decisions";
import { useProjectStore } from "./store";

/** The current project, which the sidebar's conversations and the start screen follow. */
export function useCurrentProject() {
  const repositories = useWorkspaceStore((store) => store.repositories);
  const selected = useProjectStore((store) => store.selected);
  return currentProject(repositories, selected);
}

/** The adapters adding a project uses, from the composition root. */
export function useAddDependencies(): AddDependencies {
  return {
    commands: useApplicationCommands(),
    lists: useListCache(),
    memory: useProjectMemory(),
    choosers: useChoosers(),
  };
}

/** The adapters the project actions use, from the composition root. */
export function useProjectDependencies(): ProjectDependencies {
  return {
    commands: useApplicationCommands(),
    lists: useListCache(),
    memory: useProjectMemory(),
    images: useImages(),
    files: useFiles(),
    choosers: useChoosers(),
  };
}

/** A mark's kept thumbnail as a data URL, by its image's hash, or null until it is kept. */
export function useMarkThumbnail(sha256: string | undefined): string | null {
  return useProjectStore((store) => (sha256 === undefined ? null : (store.marks[sha256] ?? null)));
}
