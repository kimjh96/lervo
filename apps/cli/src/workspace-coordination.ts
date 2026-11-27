import { coordinationEventSchemaVersion } from "@lervo/event-contract";

import { errorCode } from "./command-error-output.js";

/**
 * Whether a new conversation claims its paths (Lervo ADE coordination, "The conversation's
 * assignment and workspace"). In the last two cases the conversation writes without claims, as
 * before; the start itself still succeeds.
 */
export type WorkspaceCoordination =
  | { status: "active" }
  | {
      status: "inactive";
      code: "coordination_inactive" | "hook_runtime_stale" | "hub_coordinated_unsupported";
    }
  | { status: "unavailable"; code: "coordination_unavailable"; cause: string };

/** The conversation whose lead the coordination stage binds to its workspace's first generation. */
export interface WorkspaceCoordinationRequest {
  readonly repositoryRoot: string;
  readonly workspacePath: string;
  /** The conversation's workspace ID, which every generation of its checkout shares. */
  readonly conversationId: string;
  readonly workstreamId: string;
  readonly leadAgentId: string;
  readonly provider: string;
  /** The lead session's provider session ID. */
  readonly sessionId: string;
}

/** What the coordination stage reads and writes; each is replaced in tests. */
export interface WorkspaceCoordinationPorts {
  /** Whether the stage's gate is open for the repository (`coordinationGateOpen`). */
  stageEnabled(repositoryRoot: string): Promise<boolean>;
  /** The event schema the registered repository's writer selects. */
  writerSchemaVersion(repositoryRoot: string): Promise<number>;
  /**
   * Whether the host's installed terminal hook runtime, which the repository's and the owner's
   * sessions run, reads a conversation's workspace record as such. An older one reads it as a
   * worker's and blocks the first prompt.
   */
  hookRuntimeCurrent(): Promise<boolean>;
  /** Whether a Node of this host reserves the repository's paths at the Hub. */
  hubCoordinated(repositoryRoot: string): Promise<boolean>;
  /** Creates and claims the conversation assignment and records workspace generation 1. */
  establish(request: WorkspaceCoordinationRequest): Promise<void>;
}

/**
 * The coordination stage of `lervo workspace start` with a lead. A closed gate is
 * `coordination_inactive`, as a writer below schema 16 is. A workforce transition never
 * commits without its event, so a lease could not grow below schema 16. A host whose installed
 * hook runtime predates conversation workspaces is `hook_runtime_stale`: its hooks would read the
 * record as a worker's and block every prompt in the worktree. A Hub-coordinated
 * repository reserves fixed paths at the Hub before a claim: both stay `inactive`. Any failure is
 * `unavailable` with the failure's code, never a failed start.
 */
export async function coordinateConversationWorkspace(
  request: WorkspaceCoordinationRequest,
  ports: WorkspaceCoordinationPorts,
): Promise<WorkspaceCoordination> {
  try {
    if (
      !(await ports.stageEnabled(request.repositoryRoot)) ||
      (await ports.writerSchemaVersion(request.repositoryRoot)) < coordinationEventSchemaVersion
    )
      return { status: "inactive", code: "coordination_inactive" };
    if (!(await ports.hookRuntimeCurrent()))
      return { status: "inactive", code: "hook_runtime_stale" };
    if (await ports.hubCoordinated(request.repositoryRoot))
      return { status: "inactive", code: "hub_coordinated_unsupported" };
    await ports.establish(request);
    return { status: "active" };
  } catch (error) {
    return { status: "unavailable", code: "coordination_unavailable", cause: causeCode(error) };
  }
}

/** The failure's code as the start result carries it: lowercase, such as `enoent` for `ENOENT`. */
function causeCode(error: unknown): string {
  const code = errorCode(error)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .slice(0, 64);
  return /^[a-z0-9_]{1,64}$/u.test(code) ? code : "command_failed";
}
