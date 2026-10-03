import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import { loadProjectManifest } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  formatWorkstreamContext,
  listCanonicalizationCandidates,
  loadRepositoryKnowledgePolicy,
  scanConfiguredRepositoryKnowledge,
  sha256,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";
import { inspectKnowledgeResidentHealth } from "@lervo/repository-knowledge-runtime";
import { createSearchQueryProjection, searchQueryProjectorBuildId } from "@lervo/search";

import { createOperatingAttentionReport } from "./operating-attention-projection.js";
import type { PreparedTerminalPromptContext } from "./terminal-prompt-context.js";
import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

type WorkstreamSnapshot = Parameters<typeof formatWorkstreamContext>[0];

const MAXIMUM_ITEM_BYTES = 360;
const MAXIMUM_DECISIONS = 3;
const KNOWLEDGE_SNAPSHOT_CACHE = ".lervo/state/cache/terminal-knowledge-snapshot.json";

/** Compact prompts never project queries; this deterministic projector truthfully emits none. */
const compactQueryProjector = {
  id: "lervo.terminal-compact",
  version: 1,
  buildId: searchQueryProjectorBuildId("lervo.terminal-compact-projector.v1"),
};

function bounded(value: string, maximumBytes = MAXIMUM_ITEM_BYTES): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value;
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(`${result}${character}…`) > maximumBytes) break;
    result += character;
  }
  return `${result}…`;
}

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

export function formatCompactWorkstreamContext(snapshot: WorkstreamSnapshot) {
  const decisions = snapshot.pendingDecisions ?? [];
  const context = [
    `Lervo workstream: ${bounded(snapshot.title, 200)} (revision ${snapshot.revision}).`,
    ...(snapshot.nextActions[0] === undefined ? [] : [`Next: ${bounded(snapshot.nextActions[0])}`]),
    ...(decisions.length === 0
      ? []
      : [
          `Pending user decisions: ${decisions.length}.`,
          ...decisions
            .slice(0, MAXIMUM_DECISIONS)
            .map(
              (item) =>
                `- ${item.decisionId}${item.blocking ? " [blocking]" : ""}: ${bounded(item.question, 240)}; recommended=${item.recommendedChoiceId ?? "none"}`,
            ),
        ]),
  ].join("\n");
  return {
    workstreamId: snapshot.workstreamId,
    revision: snapshot.revision,
    snapshotHash: sha256(`${canonicalJson(snapshot)}\n`),
    scope: "prefix" as const,
    deliveredByteCount: Buffer.byteLength(context),
    context,
  };
}

export function formatCompactTerminalPreamble(input: {
  attention: OperatingAttentionReportV1;
  /** Synchronous declaration contract, used only while no background owner is running. */
  declarationInstruction: string;
  backgroundKnowledgeActive: boolean;
  workstreamPresent: boolean;
}): string {
  const blocking = input.attention.items.filter((item) => item.blocking).slice(0, 5);
  return [
    'Lervo compact terminal context. Before changing repository bytes, run `lervo knowledge query "<purpose and paths>"` for applicable rules, as AGENTS.md requires.',
    ...(blocking.length === 0
      ? []
      : [
          `Blocking attention: ${blocking.map((item) => `${item.kind}:${item.itemId}${item.requiresUserAction ? " [user]" : ""}`).join("; ")}. Details: \`lervo application attention --json\`.`,
        ]),
    ...(input.backgroundKnowledgeActive
      ? [
          "Background knowledge convergence is active and owns canonicalization, normalization, and knowledge refresh; this turn needs no knowledge refresh or turn declaration.",
        ]
      : [input.declarationInstruction]),
    input.workstreamPresent
      ? "If this turn changes repository-authored bytes, record the next bounded revision with the `lervo workstream update --actor agent --provider <current-provider>` plan/apply flow; never ask the user to run bookkeeping."
      : "If this turn changes repository-authored bytes, create a bounded checkpoint with the `lervo workstream start --actor agent --provider <current-provider>` plan/apply flow; never ask the user to run bookkeeping.",
  ].join("\n");
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
  const repositorySnapshot = await input.timing.measure("repository_snapshot", () =>
    captureTerminalRepositorySnapshot(input.root),
  );
  const [sourceSnapshotId, query, canonicalization, health] = await Promise.all([
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
        return { queryProjection, currentWorkstream, projectId: storage.manifest.projectId };
      } finally {
        await storage.close();
      }
    }),
    listCanonicalizationCandidates(input.root).then(
      (candidates) => ({ coverage: "complete" as const, candidates }),
      () => ({ coverage: "unavailable" as const, candidates: [] }),
    ),
    inspectKnowledgeResidentHealth(input.root),
  ]);
  const attention = createOperatingAttentionReport({
    projectId: query.projectId,
    workstream: query.currentWorkstream,
    canonicalization,
    knowledgeLifecycle: { coverage: "unavailable", issues: [] },
    observedAt: new Date(),
  });
  const workstream =
    query.currentWorkstream === null
      ? null
      : formatCompactWorkstreamContext(query.currentWorkstream);
  const preamble = formatCompactTerminalPreamble({
    attention,
    declarationInstruction: input.declarationInstruction,
    backgroundKnowledgeActive:
      input.workspaceBinding?.executionKind === "worker" || health.status === "healthy",
    workstreamPresent: workstream !== null,
  });
  return {
    additionalContext: workstream === null ? preamble : `${preamble}\n\n${workstream.context}`,
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
