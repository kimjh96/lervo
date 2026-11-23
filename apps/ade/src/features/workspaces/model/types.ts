import type { ConversationMode, SessionStatusMessage } from "@lervo/session-host-contract";

/** A repository the host registered, as `repository.list` returns it. */
export interface Repository {
  readonly projectId: string;
  readonly name: string;
}

/** A workspace with a hosted launch on this host, as `workspace.list` returns it. */
export interface Workspace {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly repositoryName: string;
  readonly branch: string;
  readonly title: string | null;
  readonly provider: string;
  readonly conversationMode: ConversationMode;
  readonly sessionId: string;
  readonly preparedAt: string;
}

/** A session's live status, as the session host reports it. */
export type SessionStatus = SessionStatusMessage["status"];
