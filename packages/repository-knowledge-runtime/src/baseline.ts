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

/**
 * The expensive repository half of discovery: complete scan, byte capture, normalization and
 * currency inspection. It reads only repository bytes, so it is reused while the repository fence
 * and the latest knowledge materialization are unchanged.
 */
async function observeConvergenceRepository(root: string) {
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
  // One complete byte capture; the cheap repository fence proves nothing moved around it.
  if (repositoryFence(root) !== fence)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  return {
    fence,
    manifest,
    policy,
    scan,
    delegation,
    policyHash,
    after,
    afterChanged,
    normalization,
    currency,
    candidates,
  };
}

type ConvergenceRepositoryObservation = Awaited<ReturnType<typeof observeConvergenceRepository>>;

export async function discoverConvergenceBaseline(
  root: string,
  events: OutboxStore,
  artifacts: ArtifactStore,
  observed?: ConvergenceRepositoryObservation,
): Promise<KnowledgeConvergenceBaseline> {
  const {
    manifest,
    policy,
    scan,
    delegation,
    policyHash,
    after,
    afterChanged,
    normalization,
    currency,
    candidates,
  } = observed ?? (await observeConvergenceRepository(root));
  const acceptance = loadHistoricalAcceptance(root, manifest.projectId);
  const historical = await historicalObligations(events, artifacts, acceptance?.accepted);
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

const DISCOVERY_ATTEMPTS = 3;

/**
 * A commit or edit landing during the complete capture invalidates only that capture. Retrying a
 * bounded number of times keeps a busy repository from failing every cycle before any stage runs.
 */
async function observeStableConvergenceRepository(
  root: string,
): Promise<ConvergenceRepositoryObservation> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await observeConvergenceRepository(root);
    } catch (error) {
      if (
        attempt >= DISCOVERY_ATTEMPTS ||
        (error as { code?: unknown } | null)?.code !== "source_bytes_changed"
      )
        throw error;
    }
  }
}

/** The latest knowledge materialization, read incrementally from the canonical event store. */
function materializationCursor(events: OutboxStore) {
  let afterSeq = 0;
  let latest = "";
  return (): string => {
    for (;;) {
      const page = events.list({
        afterSeq,
        limit: 1_000,
        types: ["knowledge.materialization.applied"],
      });
      if (page.length === 0) return latest;
      afterSeq = page.at(-1)!.seq;
      latest = page.at(-1)!.eventHash;
    }
  };
}

/**
 * Cycle-scoped discovery. ADR-0486: the expensive repository observation is reused while the
 * repository fence and the latest knowledge materialization are unchanged. A materialization can
 * rewrite ignored generated state the fence cannot see, so it always invalidates the observation.
 * Stage and assignment events only refresh the cheap event half, which previously repeated the
 * complete scan and currency inspection after every stage and kept a resident near one core.
 */
export function cycleScopedConvergenceDiscovery(
  root: string,
  events: OutboxStore,
  artifacts: ArtifactStore,
): () => Promise<KnowledgeConvergenceBaseline> {
  let repository: { key: string; observation: ConvergenceRepositoryObservation } | null = null;
  let last: { key: string; baseline: KnowledgeConvergenceBaseline } | null = null;
  const materialization = materializationCursor(events);
  return async () => {
    let repositoryKey: string | null;
    try {
      repositoryKey = `${convergenceRepositoryDigest(root)}:${materialization()}`;
    } catch {
      repositoryKey = null;
    }
    const key =
      repositoryKey === null ? null : `${repositoryKey}:${events.latest()?.eventHash ?? ""}`;
    if (key !== null && last?.key === key) return last.baseline;
    const observation =
      repositoryKey !== null && repository?.key === repositoryKey
        ? repository.observation
        : await observeStableConvergenceRepository(root);
    repository = repositoryKey === null ? null : { key: repositoryKey, observation };
    const baseline = await discoverConvergenceBaseline(root, events, artifacts, observation);
    last = key === null ? null : { key, baseline };
    return baseline;
  };
}
