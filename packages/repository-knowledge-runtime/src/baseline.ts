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
import { historicalObligations } from "./historical-obligations.js";

export async function discoverConvergenceBaseline(
  root: string,
  events: OutboxStore,
  artifacts: ArtifactStore,
): Promise<KnowledgeConvergenceBaseline> {
  const { manifest, policy, scan } = await scanConfiguredRepositoryKnowledge(root);
  const delegation = await loadConvergenceDelegation(root);
  const policyHash = sha256(
    canonicalJson({ contract: "background-knowledge-convergence-v1", policy }),
  );
  const before = captureConvergenceSources(root, policyHash);
  const beforeChanged = captureConvergenceChangedPaths(root);
  const [normalization, currency, candidates] = await Promise.all([
    inspectConfiguredDocumentNormalization({ repositoryRoot: root, preparedScan: scan }),
    inspectRepositoryKnowledgeCurrency(root),
    listCanonicalizationCandidates(root),
  ]);
  const historical = await historicalObligations(events, artifacts);
  const after = captureConvergenceSources(root, policyHash);
  const afterChanged = captureConvergenceChangedPaths(root);
  if (
    before.snapshotHash !== after.snapshotHash ||
    canonicalJson(beforeChanged) !== canonicalJson(afterChanged)
  )
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  const historicalEvents = historical.events;
  const assessmentPaths = [
    ...new Set([
      ...afterChanged,
      ...historical.paths,
      ...normalization.pendingDocuments,
      ...candidates
        .filter((candidate) => ["candidate", "pending", "stale"].includes(candidate.observedState))
        .flatMap((candidate) => candidate.sourceBindings.map((binding) => binding.path)),
    ]),
  ].sort();
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
      }),
    ),
    delegationHash: delegation?.contentHash ?? null,
    debtCounts,
    sources: after.sources,
    assessmentPaths,
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
