import type { AgentWorkspace } from "@lervo/agent-workforce";
import type { WorkspaceHostInspection } from "@lervo/workspace-host";

export interface TerminalWorkspaceBinding {
  executionKind: "worker" | "integrator";
  workspaceId: string;
  workspaceGeneration: number;
  workspaceRevision: number;
  assignmentId: string;
  leaseGeneration: number;
  writerSessionId: string;
  attachmentDisposition?: "activated" | "continued" | "resumed";
}

export interface TerminalWorkspaceInspection {
  issues: Array<{ code: string; command: string }>;
  binding: TerminalWorkspaceBinding;
  workspace: AgentWorkspace | null;
  assignmentRevision: number | null;
  host: WorkspaceHostInspection | null;
  changedPathSetDigest: string | null;
  changedPathCount: number | null;
}

export class TerminalWorkspaceIsolationError extends Error {
  constructor(
    readonly code:
      | "assignment_scope_changed"
      | "shared_workspace_mutation"
      | "workspace_marker_mismatch"
      | "writer_lease_lost",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TerminalWorkspaceIsolationError";
  }
}

export function terminalWorkspaceIsolationFailure(
  code: TerminalWorkspaceIsolationError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new TerminalWorkspaceIsolationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
