import { prepareTerminalInstructionPreamble } from "./terminal-instruction-context.js";
import { extractTerminalFindAnchors, formatTerminalFindPointer } from "./terminal-find-anchors.js";
import { documentIdForPath, observeContextPreparation } from "@lervo/context";
import { openProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  listCanonicalizationCandidates,
  loadRepositoryKnowledgePolicy,
  sha256,
  workstreamFreshnessPolicy,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";
import { inspectKnowledgeResidentHealth } from "@lervo/repository-knowledge-runtime";
import { createSearchQueryProjection, searchQueryProjectorBuildId } from "@lervo/search";

import { createOperatingAttentionReport } from "./operating-attention-projection.js";
import {
  assembleCompactTerminalContext,
  formatCompactTerminalPreamble,
  formatCompactWorkstreamContext,
  staleWorkstreamEntryCount,
} from "./terminal-compact-format.js";
import type { PreparedTerminalPromptContext } from "./terminal-prompt-context.js";
import { readRepositoryHealth } from "./repository-health-reader.js";
import { formatLearnedNotice } from "./learned-notice-format.js";
import { pendingTurnGovernance, readTurnGovernance } from "./turn-governance.js";
import { readLearnedNotice, readLearnedNoticeCursor } from "./learned-notice-state.js";
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
    captureTerminalRepositorySnapshot(input.root, input.timing.deadlineMs),
  );
  const [sourceSnapshotId, query, canonicalization, health, repositoryHealth, learned, governance] =
    await Promise.all([
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
      readRepositoryHealth({
        root: input.root,
        repositoryRevision: repositorySnapshot.revision,
        now: observedAt,
      }),
      pendingLearnedNotice(input.root),
      readTurnGovernance(input.root).then(pendingTurnGovernance, () => null),
    ]);
  const attention = createOperatingAttentionReport({
    projectId: query.projectId,
    workstream: query.currentWorkstream,
    workstreamFreshness: query.workstreamFreshness,
    canonicalization,
    knowledgeLifecycle: { coverage: "unavailable", issues: [] },
    health: repositoryHealth,
    observedAt,
  });
  const preamble = formatCompactTerminalPreamble({
    publicationLanguage: query.publicationLanguage,
    workspaceBinding: input.workspaceBinding,
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
  });
  // ADR-0538: exact anchors point at named skills, decisions, and nested instructions. A prompt is
  // partial evidence of scope, so anchors never narrow owner-rule selection.
  const anchors = extractTerminalFindAnchors(input.prompt, repositorySnapshot.files);
  const instructions = await prepareTerminalInstructionPreamble({
    root: input.root,
    preamble,
    maximumBytes: 4096,
    prompt: input.prompt,
    // ADR-0549: the learned notice is information, so it yields to owner rules and find pointers.
    optionalLines: [
      ...anchors.pointers.map(formatTerminalFindPointer),
      ...(governance === null ? [] : [governance.line]),
      ...(learned === null ? [] : [learned.line]),
    ],
    sourceSnapshotId,
  });
  // Only pointers that reached the context are selected; their bodies are never loaded here.
  const selectedPointers = anchors.pointers
    .slice(0, instructions.optionalLineCount)
    .map(({ path, contentHash, kind }) => ({ path, contentHash, kind }));
  const selected = selectedPointers.map((pointer) => ({
    sourceId: documentIdForPath(pointer.path),
    contentHash: pointer.contentHash,
  }));
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
        retrieval: anchors.pointers.length === 0 ? "not_run" : "completed",
        candidateCount: anchors.pointers.length === 0 ? null : anchors.pointers.length,
        selected,
        loads: selected.length === 0 ? [] : null,
      }),
      instructions: instructions.report,
    },
    additionalContext,
    sourceSnapshotId,
    recommendationCount: 0,
    documents: [],
    selectedPointers,
    repositoryRevision: repositorySnapshot.revision,
    repositoryFiles: repositorySnapshot.files,
    ...(repositorySnapshot.commits === undefined
      ? {}
      : { repositoryCommits: repositorySnapshot.commits }),
    workstream,
    attention,
    ...(learned === null ? {} : { learnedNotice: learned }),
    ...(governance === null ? {} : { governance }),
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
    selection:
      selected.length === 0
        ? { disposition: "query_projection_missing", selectedCount: 0 }
        : { disposition: "selected", selectedCount: selected.length },
  };
}

/** ADR-0549: the prepared notice, unless an owner turn was already shown everything it covers. */
async function pendingLearnedNotice(
  root: string,
): Promise<{ throughCommit: string; line: string } | null> {
  const [notice, cursor] = await Promise.all([
    readLearnedNotice(root),
    readLearnedNoticeCursor(root),
  ]);
  if (notice?.throughCommit == null || notice.throughCommit === cursor?.shownThrough) return null;
  const line = formatLearnedNotice(notice);
  return line === null ? null : { throughCommit: notice.throughCommit, line };
}
