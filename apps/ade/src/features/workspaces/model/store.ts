import { create } from "zustand";

import type { Repository, SessionStatus, Workspace } from "./types";

interface WorkspaceStore {
  readonly repositories: readonly Repository[];
  readonly workspaces: readonly Workspace[];
  /** Live status by session ID, from the session host's watch. */
  readonly statuses: Readonly<Record<string, SessionStatus>>;
  readonly selected: string | null;
  select(workspaceId: string | null): void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  repositories: [],
  workspaces: [],
  statuses: {},
  selected: null,
  select: (selected) => set({ selected }),
}));
