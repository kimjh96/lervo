import { create } from "zustand";

import type { Repository, SessionStatus, Workspace } from "./types";

interface WorkspaceStore {
  readonly repositories: readonly Repository[];
  readonly workspaces: readonly Workspace[];
  /** Whether the lists loaded once. */
  readonly loaded: boolean;
  /** Workspaces that appeared after the first load, while the user watched. */
  readonly arrived: ReadonlySet<string>;
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
  arrived: new Set(),
  statuses: {},
  selected: null,
  newWorkRequests: 0,
  select: (selected) => set({ selected }),
  newWork: () => set((store) => ({ selected: null, newWorkRequests: store.newWorkRequests + 1 })),
}));
