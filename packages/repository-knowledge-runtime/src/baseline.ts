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
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

import { loadConvergenceDelegation } from "./delegation.js";
import { captureConvergenceSources } from "./source-capture.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Old attention outcomes and dropped queue admissions stay visible until a later baseline covers them. */
async function historicalObligations(
  events: OutboxStore,
  artifacts: ArtifactStore,
): Promise<KnowledgeConvergenceBaseline["historicalEvents"]> {
  const changes = new Map<
    string,
    { eventId: string; eventHash: string; failureCode: string | null }
  >();
  let afterSeq = 0;
  for (;;) {
    const page = events.list({ afterSeq, limit: 1_000 });
    if (page.length === 0) break;
    for (const event of page) {
      afterSeq = event.seq;
      if (event.type === "repository.change.completed")
        changes.set(event.eventId, {
          eventId: event.eventId,
          eventHash: event.eventHash,
          failureCode: "knowledge_continuation_missing",
        });
      if (event.type === "repository.knowledge.resolved") {
        const id = event.payload.changeEventId as string;
        if (event.payload.terminalState === "current") changes.delete(id);
        else
          changes.set(id, {
            eventId: event.eventId,
            eventHash: event.eventHash,
            failureCode:
              (event.payload.failureCode as string | null) ?? "canonicalization_candidate_missing",
          });
      }
      if (changes.size > 20_000)
        throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
      if (
        event.type === "repository.knowledge.convergence.recorded" &&
        event.payload.terminalState === "current"
      ) {
        const hash = event.payload.lifecycleReceiptDigest as string;
        const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
        if (sha256(bytes) !== hash)
          throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
        const receipt = JSON.parse(
          new TextDecoder("utf8", { fatal: true }).decode(bytes),
        ) as KnowledgeConvergenceInput;
        if (
          receipt.obligationId !== event.payload.obligationId ||
          receipt.baseline.projectId !== event.projectId
        )
          throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
        const covered = new Map(
          receipt.baseline.historicalEvents.map((source) => [source.eventId, source.eventHash]),
        );
        for (const [id, source] of changes)
          if (covered.get(source.eventId) === source.eventHash) changes.delete(id);
      }
    }
  }
  // A live generic source has a durable queue owner; completed attention remains baseline debt.
  return [...changes.entries()]
    .filter(
      ([id, source]) =>
        source.eventId !== id || events.getOutbox(id, "knowledge:repository") === null,
    )
    .map(([, source]) => source);
}

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
  const [normalization, currency, candidates] = await Promise.all([
    inspectConfiguredDocumentNormalization({ repositoryRoot: root, preparedScan: scan }),
    inspectRepositoryKnowledgeCurrency(root),
    listCanonicalizationCandidates(root),
  ]);
  const historicalEvents = await historicalObligations(events, artifacts);
  const after = captureConvergenceSources(root, policyHash);
  if (before.snapshotHash !== after.snapshotHash)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
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
      }),
    ),
    delegationHash: delegation?.contentHash ?? null,
    debtCounts,
    sources: after.sources,
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
