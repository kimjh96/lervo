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
  readonly conversationMode: "native" | "cli";
  readonly sessionId: string;
  readonly preparedAt: string;
}

export type SessionStatus = "starting" | "working" | "needs_user" | "idle" | "ended";
