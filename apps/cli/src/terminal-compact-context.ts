import { prepareTerminalInstructionPreamble } from "./terminal-instruction-context.js";
import { observeContextPreparation } from "@lervo/context";
import { openProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  documentFreshnessCompactLine,
  listCanonicalizationCandidates,
  loadRepositoryKnowledgePolicy,
  sha256,
  workstreamFreshnessPolicy,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";
import {
  documentFreshnessSummary,
  inspectKnowledgeResidentHealth,
} from "@lervo/repository-knowledge-runtime";
import { createSearchQueryProjection, searchQueryProjectorBuildId } from "@lervo/search";

import { createOperatingAttentionReport } from "./operating-attention-projection.js";
import {
  assembleCompactTerminalContext,
  formatCompactTerminalPreamble,
  formatCompactWorkstreamContext,
  staleWorkstreamEntryCount,
} from "./terminal-compact-format.js";
import type { PreparedTerminalPromptContext } from "./terminal-prompt-context.js";
import {
  instructionCaptureCompactLines,
  readInstructionCaptureAttention,
} from "./instruction-capture-attention.js";
import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";
import { observeWorkstreamFreshness } from "./workstream-repository-head.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";
import { terminalKnowledgeSnapshotId } from "./terminal-knowledge-snapshot.js";

export {
  terminalKnowledgeSnapshotId,
  prefetchTerminalPromptContext,
} from "./terminal-knowledge-snapshot.js";

/** Compact prompts never project queries; this deterministic projector truthfully emits none. */
const compactQueryProjector = {
  id: "lervo.terminal-compact",
  version: 1,
  buildId: searchQueryProjectorBuildId("lervo.terminal-compact-projector.v1"),
};

/**
 * Compact terminal context keeps every prompt fast and small: the continuation headline, decisions
 * the user owns, and blocking attention. It runs no provider projection and no document retrieval;
 * repository rules stay on demand through `lervo knowledge query`, as AGENTS.md requires.
 */
export async function prepareCompactTerminalPromptContext(input: {
  root: string;
  prompt: string;
  provider: TerminalIntegrationProvider;
  workspaceBinding: TerminalWorkspaceBinding | null;
  timing: TerminalStageObservationPort;
  declarationInstruction: string;
}): Promise<PreparedTerminalPromptContext> {
  const requestDigest = sha256(input.prompt);
  const observedAt = new Date();
  const repositorySnapshot = await input.timing.measure("repository_snapshot", () =>
    captureTerminalRepositorySnapshot(input.root),
  );
  const [
    sourceSnapshotId,
    query,
    canonicalization,
    health,
    documentFreshnessLine,
    instructionCaptureLines,
  ] = await Promise.all([
    input.timing.measure("corpus_preparation", () =>
      terminalKnowledgeSnapshotId(input.root, repositorySnapshot.revision),
    ),
    input.timing.measure("query_projection", async () => {
      const storage = await openProjectStorage(input.root);
      try {
        const [policy, currentWorkstream] = await Promise.all([
          loadRepositoryKnowledgePolicy(input.root),
          verifiedCurrentWorkstream(storage),
        ]);
        const workstreamFreshness =
          currentWorkstream === null
            ? null
            : await observeWorkstreamFreshness({
                root: input.root,
                snapshot: currentWorkstream,
                policy: workstreamFreshnessPolicy(policy),
                observedAt,
              });
        const queryProjection = createSearchQueryProjection({
          projector: compactQueryProjector,
          requestDigest,
          contextDigest: sha256(canonicalJson({ contextRequirement: "none" })),
          projectorResultDigest: sha256("lervo.terminal-compact.no-queries"),
          requestedLanguage: policy.publication.language,
          queries: [],
          durationMs: 0,
          status: "empty",
        });
        return {
          publicationLanguage: policy.publication.language,
          queryProjection,
          currentWorkstream,
          workstreamFreshness,
          projectId: storage.manifest.projectId,
        };
      } finally {
        await storage.close();
      }
    }),
    listCanonicalizationCandidates(input.root).then(
      (candidates) => ({ coverage: "complete" as const, candidates }),
      () => ({ coverage: "unavailable" as const, candidates: [] }),
    ),
    inspectKnowledgeResidentHealth(input.root),
    documentFreshnessSummary(input.root, observedAt).then(documentFreshnessCompactLine, () => null),
    readInstructionCaptureAttention(input.root).then(
      (attention) => instructionCaptureCompactLines(attention, false),
      () => [],
    ),
  ]);
  const attention = createOperatingAttentionReport({
    projectId: query.projectId,
    workstream: query.currentWorkstream,
    workstreamFreshness: query.workstreamFreshness,
    canonicalization,
    knowledgeLifecycle: { coverage: "unavailable", issues: [] },
    observedAt,
  });
  const preamble = formatCompactTerminalPreamble({
    publicationLanguage: query.publicationLanguage,
    attention,
    declarationInstruction: input.declarationInstruction,
    backgroundKnowledgeActive:
      input.workspaceBinding?.executionKind === "worker" || health.status === "healthy",
    workstreamPresent: query.currentWorkstream !== null,
    staleWorkstreamEntryCount: staleWorkstreamEntryCount(
      attention,
      query.currentWorkstream,
      query.workstreamFreshness,
    ),
    documentFreshnessLine,
    instructionCaptureLines,
  });
  const instructions = await prepareTerminalInstructionPreamble({
    root: input.root,
    preamble,
    maximumBytes: 4096,
    prompt: input.prompt,
    sourceSnapshotId,
  });
  const { additionalContext, workstream } = assembleCompactTerminalContext(
    instructions.preamble,
    query.currentWorkstream === null || query.workstreamFreshness === null
      ? null
      : formatCompactWorkstreamContext(query.currentWorkstream, query.workstreamFreshness),
  );
  return {
    quality: instructions.quality,
    preparationQuality: {
      ...observeContextPreparation({
        requestDigest,
        sourceSnapshotId,
        retrieval: "not_run",
        candidateCount: null,
        selected: [],
        loads: [],
      }),
      instructions: instructions.report,
    },
    additionalContext,
    sourceSnapshotId,
    recommendationCount: 0,
    documents: [],
    repositoryRevision: repositorySnapshot.revision,
    repositoryFiles: repositorySnapshot.files,
    ...(repositorySnapshot.commits === undefined
      ? {}
      : { repositoryCommits: repositorySnapshot.commits }),
    workstream,
    attention,
    grounding: {
      requestDigest,
      queryDigest: query.queryProjection.receipt.projectedQueryDigest,
      status: "abstain",
      workflowId: null,
      sourceClasses: [],
      subjectIds: [],
      retrievalQueries: [],
      providerIds: [],
      reasons: ["unmanaged_terminal_retrieval_only"],
      queryProjectionReceipt: query.queryProjection.receipt,
    },
    durableInstruction: {
      status: "ignored",
      ruleId: null,
      targetPath: null,
      reasonIds: ["unmanaged_terminal_retrieval_only"],
    },
    selection: { disposition: "query_projection_missing", selectedCount: 0 },
  };
}
