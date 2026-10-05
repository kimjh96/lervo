import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadProjectManifest } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  documentFreshnessCompactLine,
  listCanonicalizationCandidates,
  loadRepositoryKnowledgePolicy,
  scanConfiguredRepositoryKnowledge,
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

const KNOWLEDGE_SNAPSHOT_CACHE = ".lervo/state/cache/terminal-knowledge-snapshot.json";

/** Compact prompts never project queries; this deterministic projector truthfully emits none. */
const compactQueryProjector = {
  id: "lervo.terminal-compact",
  version: 1,
  buildId: searchQueryProjectorBuildId("lervo.terminal-compact-projector.v1"),
};

interface CachedKnowledgeSnapshot {
  schemaVersion: 1;
  repositoryRevision: string;
  projectId: string;
  policyId: string;
  sourceSnapshotId: string;
}

async function readKnowledgeSnapshotCache(root: string): Promise<CachedKnowledgeSnapshot | null> {
  try {
    const value = JSON.parse(
      await readFile(resolve(root, KNOWLEDGE_SNAPSHOT_CACHE), "utf8"),
    ) as CachedKnowledgeSnapshot;
    return value?.schemaVersion === 1 && /^ksnap_[a-f0-9]{24}$/u.test(value.sourceSnapshotId)
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Knowledge snapshot identity is a pure function of repository bytes and policy, so it is cached by
 * the exact repository revision. Stop prefetches it for the post-turn bytes; a revision mismatch
 * recomputes it, and a concurrent edit during the scan is never cached.
 */
export async function terminalKnowledgeSnapshotId(
  root: string,
  repositoryRevision: string,
): Promise<string> {
  const [cached, manifest, policy] = await Promise.all([
    readKnowledgeSnapshotCache(root),
    loadProjectManifest(root),
    loadRepositoryKnowledgePolicy(root),
  ]);
  if (
    cached?.repositoryRevision === repositoryRevision &&
    cached.projectId === manifest.projectId &&
    cached.policyId === policy.policyId
  )
    return cached.sourceSnapshotId;
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  if ((await captureTerminalRepositorySnapshot(root)).revision === repositoryRevision) {
    const value: CachedKnowledgeSnapshot = {
      schemaVersion: 1,
      repositoryRevision,
      projectId: manifest.projectId,
      policyId: policy.policyId,
      sourceSnapshotId: scan.snapshotId,
    };
    try {
      const target = resolve(root, KNOWLEDGE_SNAPSHOT_CACHE);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(`${target}.${process.pid}.tmp`, JSON.stringify(value), { mode: 0o600 });
      await rename(`${target}.${process.pid}.tmp`, target);
    } catch {
      // The cache only saves time on the next prompt.
    }
  }
  return scan.snapshotId;
}

/** Stop runs this detached so the next prompt finds the post-turn knowledge snapshot ready. */
export async function prefetchTerminalPromptContext(root: string): Promise<void> {
  const snapshot = await captureTerminalRepositorySnapshot(root);
  await terminalKnowledgeSnapshotId(root, snapshot.revision);
}

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
    readInstructionCaptureAttention(input.root).then(instructionCaptureCompactLines, () => []),
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
  const { additionalContext, workstream } = assembleCompactTerminalContext(
    preamble,
    query.currentWorkstream === null || query.workstreamFreshness === null
      ? null
      : formatCompactWorkstreamContext(query.currentWorkstream, query.workstreamFreshness),
  );
  return {
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
