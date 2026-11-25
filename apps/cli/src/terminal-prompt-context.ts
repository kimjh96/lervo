import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import type { RepositorySnapshot } from "@lervo/orchestrator";
import type { ContextQualityPreparationResult } from "@lervo/repository-context";
import type { KnowledgeQueryHit, TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import type { ContextPreparationReport } from "@lervo/schemas";
import type { SearchQueryProjectionReceipt } from "@lervo/search";

import { prepareCompactTerminalPromptContext } from "./terminal-compact-context.js";
import { terminalDeclarationInstruction } from "./terminal-declaration-instruction.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";

export interface PreparedTerminalDocument {
  conceptId: string;
  path: string;
  contentHash: string;
  scope: "full" | "prefix";
  deliveredByteCount: number;
  assurance: KnowledgeQueryHit["assurance"];
  freshness: KnowledgeQueryHit["freshness"];
}

export interface PreparedTerminalPromptContext {
  preparationQuality: ContextPreparationReport;
  quality?: ContextQualityPreparationResult;
  additionalContext: string;
  sourceSnapshotId: string;
  recommendationCount: number;
  documents: PreparedTerminalDocument[];
  selectedPointers?: {
    path: string;
    contentHash: string;
    kind: "skill" | "decision" | "instruction";
  }[];
  repositoryRevision: string;
  repositoryFiles: RepositorySnapshot["files"];
  repositoryCommits?: RepositorySnapshot["commits"];
  workstream: {
    workstreamId: string;
    revision: number;
    snapshotHash: string;
    scope: "full" | "prefix";
    deliveredByteCount: number;
    context: string;
  } | null;
  attention: OperatingAttentionReportV1;
  /** ADR-0549 learned notice placed in this turn, recorded as shown after the turn is prepared. */
  learnedNotice?: { throughCommit: string; noticesThrough?: string; line: string };
  /** ADR-0552 check line about the previous turn's unconsulted governing canon. */
  governance?: { pendingAt: string; line: string };
  grounding: {
    requestDigest: string;
    queryDigest: string;
    status: "ready" | "clarify" | "abstain" | "approval_required";
    workflowId: string | null;
    sourceClasses: string[];
    subjectIds: string[];
    retrievalQueries: string[];
    providerIds: string[];
    reasons: string[];
    queryProjectionReceipt: SearchQueryProjectionReceipt;
  };
  durableInstruction: {
    status: "ignored" | "workstream" | "current" | "pending" | "applied" | "blocked";
    ruleId: string | null;
    targetPath: string | null;
    reasonIds: string[];
  };
  selection: {
    disposition: "query_projection_missing" | "no_candidates" | "selected";
    selectedCount: number;
  };
}

/**
 * The context a prompt receives. Every prompt takes compact context (ADR-0451, ADR-0634): the
 * continuation headline, owner rules, attention, plan lines, and exact pointers. Documents come on
 * demand through `lervo knowledge query`, never through a per-prompt retrieval.
 */
export async function prepareTerminalPromptContext(input: {
  root: string;
  /** The checkout whose files the context describes; defaults to `root`. */
  executionRoot?: string;
  prompt: string;
  provider: TerminalIntegrationProvider;
  observationId: string;
  workspaceBinding: TerminalWorkspaceBinding | null;
  timing: TerminalStageObservationPort;
}): Promise<PreparedTerminalPromptContext> {
  return prepareCompactTerminalPromptContext({
    ...input,
    declarationInstruction: terminalDeclarationInstruction(input.provider, input.observationId),
  });
}
