import type { RepositorySummary, WorkspaceSummary } from "@lervo/session-host-contract";

/** The workspace and repository lists the core answered last. */
export interface Lists {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly repositories: readonly RepositorySummary[];
}

/**
 * The lists kept from the last launch, so the start screen renders at once and refreshes when the
 * core answers (ADE performance, "Processes, protocol, and startup").
 */
export interface ListCache {
  /** The kept lists, or null when none are kept or they cannot be read. */
  load(): Lists | null;
  /** Keeps the lists for the next launch; a refused write keeps the previous ones. */
  save(lists: Lists): void;
}
