import { create } from "zustand";

import type { Repository, SessionStatus, Workspace } from "./types";

interface WorkspaceStore {
  readonly repositories: readonly Repository[];
  readonly workspaces: readonly Workspace[];
  /** Whether the lists loaded once. */
  readonly loaded: boolean;
  /** Whether the lists shown are the ones kept from the last launch, until the core answers. */
  readonly cached: boolean;
  /** Workspaces that appeared after the first load, while the user watched. */
  readonly arrived: ReadonlySet<string>;
  /** The code of the last failed reload, until a reload succeeds. */
  readonly listFailure: string | null;
  /**
   * The application commands the core named in its last workspace list: empty for an older core
   * that names none, and null before the first list.
   */
  readonly advertisedCommands: readonly string[] | null;
  /** Live status by session ID, from the session host's watch. */
  readonly statuses: Readonly<Record<string, SessionStatus>>;
  readonly selected: string | null;
  /** Counts "New work" requests, so the start screen focuses its input on each one. */
  readonly newWorkRequests: number;
  select(workspaceId: string | null): void;
  /** Opens the start screen and asks it to focus the instruction. */
  newWork(): void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  repositories: [],
  workspaces: [],
  loaded: false,
  cached: false,
  arrived: new Set(),
  listFailure: null,
  advertisedCommands: null,
  statuses: {},
  selected: null,
  newWorkRequests: 0,
  // Selecting what is already selected changes nothing, so nothing re-renders or moves.
  select: (selected) => set((store) => (store.selected === selected ? store : { selected })),
  newWork: () => set((store) => ({ selected: null, newWorkRequests: store.newWorkRequests + 1 })),
}));
