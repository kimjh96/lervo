import {
  useApplicationCommands,
  useChoosers,
  useFiles,
  useImages,
  useListCache,
  useProjectMemory,
} from "../../../ports";
import { useWorkspaceStore } from "../../workspaces";
import type { ProjectDependencies } from "./controller";
import { currentProject } from "./decisions";
import { useProjectStore } from "./store";

/** The current project, which the sidebar's conversations and the start screen follow. */
export function useCurrentProject() {
  const repositories = useWorkspaceStore((store) => store.repositories);
  const selected = useProjectStore((store) => store.selected);
  return currentProject(repositories, selected);
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
