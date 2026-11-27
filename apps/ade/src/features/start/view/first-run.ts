import { managesProjects } from "../../projects";
import { useWorkspaceStore } from "../../workspaces";

/** What the first run reads of the lists. */
interface ListState {
  readonly loaded: boolean;
  readonly cached: boolean;
  readonly repositories: readonly unknown[];
  readonly advertisedCommands: readonly string[] | null;
}

/**
 * Whether the start screen is the first run (Lervo ADE projects, "The first run"): the lists
 * loaded empty from a core that adds projects. An older core that adds none keeps the start card
 * with its explanation.
 *
 * - `known`: whether the start screen may choose yet, once the core's lists loaded or kept lists
 *   with projects stand in. Kept lists without a project do not keep what the core can do, so the
 *   screen waits for the core instead of showing the older core's start card, then the first run.
 * - `folded`: whether the sidebar folds away, for a first run or for kept lists without a project
 *   while the core answers, so an empty sidebar never shows before it folds.
 */
export function firstRunOf(state: ListState) {
  const managed = managesProjects(state.advertisedCommands);
  const empty = state.repositories.length === 0;
  return {
    managed,
    active: state.loaded && empty && managed,
    known: state.loaded || (state.cached && !empty),
    folded: empty && (state.loaded ? managed : state.cached),
  };
}

/** The first run of the shown lists. */
export function useFirstRun() {
  const managed = useWorkspaceStore((store) => firstRunOf(store).managed);
  const active = useWorkspaceStore((store) => firstRunOf(store).active);
  const known = useWorkspaceStore((store) => firstRunOf(store).known);
  const folded = useWorkspaceStore((store) => firstRunOf(store).folded);
  return { active, managed, known, folded };
}
