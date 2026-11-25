import type { ContextPreparationReport } from "@lervo/schemas";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import type {
  TerminalWorkspaceBinding,
  TerminalWorkspaceInspection,
} from "./terminal-workspace-lifecycle.js";

export type TerminalHookEvent = "UserPromptSubmit" | "Stop";

export interface ParsedTerminalHookInput {
  event: TerminalHookEvent;
  providerSessionId: string;
  providerTurnId: string | null;
  stopHookActive: boolean;
  prompt?: string;
  lastAssistantMessage?: string | null;
  transcriptPath?: string;
}

/**
 * A provider `SessionStart` (ADR-0562 section 4): a session started, resumed, cleared, or
 * compacted. It carries no prompt or turn, and it answers with the epoch's base block.
 */
export interface ParsedSessionStartInput {
  event: "SessionStart";
  providerSessionId: string;
  source: "startup" | "resume" | "clear" | "compact";
  /** The provider transcript, whose size marks where this start's base block will appear. */
  transcriptPath?: string;
}

export interface UnmanagedTerminalCoordinates {
  runId: string;
  sessionId: string;
  providerSessionDigest: string;
  providerTurnDigest: string | null;
}

export interface PreparedTerminalTurnExpectation {
  contextEventId: string;
  observationId: string;
  provider: TerminalIntegrationProvider;
  providerSessionId: string;
  /** When set, the workspace check uses it instead of `providerSessionId`, which a settlement lacks. */
  providerSessionDigest?: string;
  workstreamId: string | null;
  revision: number | null;
  repositoryRevision: string;
  preparedAt: string;
  workspaceBinding: TerminalWorkspaceBinding | null;
}

export interface TerminalActivationReceipt {
  schemaVersion: 1;
  contractId: "lervo_terminal_hooks_v1" | "lervo_terminal_hooks_v2";
  provider: TerminalIntegrationProvider;
  hookEvent: TerminalHookEvent;
  result: "context_prepared" | "completion_allowed" | "completion_blocked";
  occurredAt: string;
  queryDigest?: string;
  queryProjectionReceiptId?: string;
  sourceSnapshotId?: string;
  preparationQuality?: ContextPreparationReport;
  recommendationCount?: number;
  loadedDocumentCount?: number;
  contextHash?: string;
  repositoryRevision?: string;
  observationEventId?: string;
  referenceCount?: number;
  selectedCount?: number;
  pathMentionCount?: number;
}

export interface TerminalRuntimeActivation {
  status: "observed" | "partial" | "not_observed";
  evidenceMeaning: "hook_endpoint_observed_not_provider_authorship";
  observations: Array<{
    provider: TerminalIntegrationProvider;
    hookEvent: TerminalHookEvent;
    status: "observed" | "not_observed";
    occurredAt: string | null;
  }>;
}

export interface TerminalActivationReadiness {
  status: "ready" | "action_required";
  actions: Array<{
    provider: TerminalIntegrationProvider;
    code: "codex_hook_review_or_activation_required" | "claude_hook_activation_required";
    instruction: string;
  }>;
}

export interface TerminalLifecycleInspection {
  schemaVersion: 1;
  status: "current" | "action_required";
  repositoryRoot: string;
  issues: Array<{ code: string; command: string; detail?: string }>;
  /** Agent-owned document drift attention (ADR-0464); excluded from `status`. */
  knowledgeAdvisories?: Array<{ code: string; command: string; detail?: string }>;
  /** Host service attention, such as an unreachable user manager (ADR-0573); excluded from `status`. */
  serviceAdvisories?: Array<{ code: string; command: string; detail?: string }>;
  activation: TerminalActivationReceipt[];
  runtimeActivation: TerminalRuntimeActivation;
  activationReadiness: TerminalActivationReadiness;
  repositoryChange: {
    beforeRevision: string;
    afterRevision: string;
    changed: boolean;
  };
  workspace: TerminalWorkspaceInspection | null;
}
