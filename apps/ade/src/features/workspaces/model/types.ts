import type {
  RepositorySummary,
  SessionStatusMessage,
  WorkspaceSummary,
} from "@lervo/session-host-contract";

/** A repository the host registered, as `repository.list` returns it. */
export type Repository = RepositorySummary;

/**
 * A workspace with a hosted launch on this host, as `workspace.list` returns it. A workspace from
 * an older core has no `conversationModes`.
 */
export type Workspace = WorkspaceSummary;

/** A session's live status, as the session host reports it. */
export type SessionStatus = SessionStatusMessage["status"];
