import { managesProjects } from "../../projects";
import { useWorkspaceStore } from "../../workspaces";

/**
 * Whether the start screen is the first run (Lervo ADE projects, "The first run"): the lists
 * loaded empty from a core that adds projects. An older core that adds none keeps the start card
 * with its explanation.
 */
export function useFirstRun() {
  const managed = useWorkspaceStore((store) => managesProjects(store.advertisedCommands));
  const active = useWorkspaceStore(
    (store) =>
      store.loaded && store.repositories.length === 0 && managesProjects(store.advertisedCommands),
  );
  return { active, managed };
}
