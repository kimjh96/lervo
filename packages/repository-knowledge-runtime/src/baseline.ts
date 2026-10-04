import {
  repositoryPathMatchesPatterns,
  canonicalJson,
  sha256,
  scanConfiguredRepositoryKnowledge,
  inspectConfiguredDocumentNormalization,
  inspectRepositoryKnowledgeCurrency,
  listCanonicalizationCandidates,
  type KnowledgeConvergenceBaseline,
} from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { loadConvergenceDelegation } from "./delegation.js";
import { captureConvergenceChangedPaths, captureConvergenceSources } from "./source-capture.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { convergenceRepositoryDigest } from "./source-fingerprint.js";
import { historicalObligations } from "./historical-obligations.js";
import { settledCanonicalDispositions } from "./canonical-disposition-ledger.js";
import { loadHistoricalAcceptance } from "./historical-acceptance.js";

function repositoryFence(root: string): string {
  try {
    return convergenceRepositoryDigest(root);
  } catch (error) {
    if (error instanceof KnowledgeConvergenceRuntimeError) throw error;
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_unavailable", {
      cause: error,
    });
  }
}

export async function discoverConvergenceBaseline(
  root: string,
  events: OutboxStore,
  artifacts: ArtifactStore,
): Promise<KnowledgeConvergenceBaseline> {
  const fence = repositoryFence(root);
  const { manifest, policy, scan } = await scanConfiguredRepositoryKnowledge(root);
  const delegation = await loadConvergenceDelegation(root);
  const policyHash = sha256(
    canonicalJson({ contract: "background-knowledge-convergence-v1", policy }),
  );
  const after = captureConvergenceSources(root, policyHash);
  const afterChanged = captureConvergenceChangedPaths(root);
  const [normalization, currency, candidates] = await Promise.all([
    inspectConfiguredDocumentNormalization({ repositoryRoot: root, preparedScan: scan }),
    inspectRepositoryKnowledgeCurrency(root, { preparedScan: scan }),
    listCanonicalizationCandidates(root),
  ]);
  const acceptance = loadHistoricalAcceptance(root, manifest.projectId);
  const historical = await historicalObligations(events, artifacts, acceptance?.accepted);
  // One complete byte capture; the cheap repository fence proves nothing moved around it.
  if (repositoryFence(root) !== fence)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  const historicalEvents = historical.events;
  const obligationPaths = new Set([
    ...afterChanged,
    ...historical.paths,
    ...normalization.pendingDocuments,
    ...candidates
      .filter((candidate) => ["candidate", "pending", "stale"].includes(candidate.observedState))
      .flatMap((candidate) => candidate.sourceBindings.map((binding) => binding.path)),
  ]);
  const obligationSources = after.sources.filter(
    (source) => source.kind === "text" && obligationPaths.has(source.path),
  );
  // Exact bytes produced or settled by reviewed Lervo effects never return to provider review.
  const reviewedRewrites = new Map(
    normalization.records
      .filter((record) => record.status === "current" && record.recordId !== null)
      .flatMap((record) => record.reviewedRewritePaths.map((path) => [path, record.recordId!])),
  );
  const ledger = new Map(
    (
      await settledCanonicalDispositions({
        repositoryRoot: root,
        events,
        artifacts,
        projectId: manifest.projectId,
        policyHash,
        sources: obligationSources,
      })
    ).map((item) => [item.path, item.eventId]),
  );
  const settledAssessments = obligationSources.flatMap(({ path, contentHash }) => {
    const reference = ledger.get(path) ?? reviewedRewrites.get(path);
    return reference === undefined ? [] : [{ path, contentHash, reference }];
  });
  const settled = new Set(settledAssessments.map((item) => item.path));
  const assessmentPaths = [...obligationPaths].filter((path) => !settled.has(path)).sort();
  const canonicalization = candidates.filter((candidate) =>
    ["candidate", "pending", "stale"].includes(candidate.observedState),
  ).length;
  const debtCounts = {
    canonicalization,
    normalization: normalization.pendingDocuments.length,
    lifecycle: currency.reasons.length,
    historical: historicalEvents.length,
  };
  return {
    schemaVersion: 1,
    projectId: manifest.projectId,
    sourceSnapshotId: after.snapshotId,
    sourceSnapshotHash: after.snapshotHash,
    sourceCommit: after.head,
    policyHash,
    debtDigest: sha256(
      canonicalJson({
        debtCounts,
        normalizationPaths: normalization.pendingDocuments,
        candidates: candidates.map((candidate) => [
          candidate.candidateId,
          candidate.contentHash,
          candidate.observedState,
        ]),
        historicalEvents,
        assessmentPaths,
        settledAssessments,
        historyAcceptanceHash: acceptance?.contentHash ?? null,
      }),
    ),
    delegationHash: delegation?.contentHash ?? null,
    debtCounts,
    sources: after.sources,
    assessmentPaths,
    settledAssessments,
    historyAcceptanceHash: acceptance?.contentHash ?? null,
    sourceDispositions: after.sources.map((source) => {
      const record = scan.sources.find((item) => item.path === source.path);
      const kind =
        record?.classification === "secret_candidate" || record?.classification === "sensitive"
          ? "sensitive_local"
          : repositoryPathMatchesPatterns(source.path, policy.exclude)
            ? "policy_excluded"
            : source.kind === "opaque"
              ? "opaque_verification"
              : "semantic_source";
      return {
        path: source.path,
        contentHash: source.contentHash,
        kind,
        reason: kind === "semantic_source" ? "ordinary_source" : (record?.reason ?? kind),
      };
    }),
    normalizationPaths: normalization.pendingDocuments,
    historicalEvents,
  };
}

/**
 * Cycle-scoped discovery: an unchanged repository digest and canonical event head reuse the last
 * baseline, so dependency checks and the closing status do not repeat the complete capture.
 */
export function cycleScopedConvergenceDiscovery(
  root: string,
  events: OutboxStore,
  artifacts: ArtifactStore,
): () => Promise<KnowledgeConvergenceBaseline> {
  let last: { key: string; baseline: KnowledgeConvergenceBaseline } | null = null;
  return async () => {
    let key: string | null;
    try {
      key = `${convergenceRepositoryDigest(root)}:${events.latest()?.eventHash ?? ""}`;
    } catch {
      key = null;
    }
    if (key !== null && last?.key === key) return last.baseline;
    const baseline = await discoverConvergenceBaseline(root, events, artifacts);
    last = key === null ? null : { key, baseline };
    return baseline;
  };
}
