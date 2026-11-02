import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildDocumentFreshnessCandidate,
  documentFreshnessFindingActionable,
  filesystemDocumentFreshnessOracle,
  freshnessReferenceMissing,
  parseDocumentFreshnessProposal,
  reviewIntervalOnlyFreshnessCandidate,
  stableId,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessOwnership,
  type DocumentFreshnessPolicy,
  type PrioritizedDocumentFreshnessFinding,
} from "@lervo/repository-knowledge";

import {
  applyCrossCheckedFreshnessHunks,
  freshnessCrossCheckPending,
  prepareFreshnessCrossCheck,
  runFreshnessCrossCheck,
} from "./freshness-cross-check.js";
import { buildFreshnessEvidenceBundle, freshnessBundleBytes } from "./freshness-evidence-bundle.js";
import { recordFreshnessCandidateOutcome } from "./freshness-events.js";
import {
  generateFreshnessProposal,
  type FreshnessGenerationContext,
} from "./freshness-generation.js";
import { writeFreshnessCandidate } from "./freshness-state-store.js";
import {
  captureFreshnessDependencies,
  freshnessDependenciesCurrent,
} from "./freshness-dependencies.js";
import { settleFreshnessAssessment } from "./freshness-assessment.js";

const MAXIMUM_INBOUND_DOCUMENTS = 8_192;

export type FreshnessFindingOutcome =
  | { status: "deferred"; reason: string }
  | {
      status: "evidence_deferred";
      reason: "freshness_evidence_unavailable" | "freshness_evidence_incomplete";
      receiptHash: string;
      nextCursor: string | null;
    }
  | { status: "candidate"; candidate: DocumentFreshnessCandidateV1; tokensObserved: number };

/** Tracked Markdown documents other than the archived one, read only for an archive proposal. */
function inboundMarkdown(
  root: string,
  documentPath: string,
): Array<{ path: string; content: string }> {
  const listed = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "*.md"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\0")
    .filter((path) => path !== "" && path !== documentPath)
    .slice(0, MAXIMUM_INBOUND_DOCUMENTS);
  return listed.flatMap((path) => {
    try {
      return [{ path, content: readFileSync(resolve(root, path), "utf8") }];
    } catch {
      return [];
    }
  });
}

/**
 * Turns one admitted finding into a stored candidate: bundle the evidence into CAS, run the
 * governed provider call, build and verify the candidate, run its Tier 0 cross-check in a separate
 * session, record its events, and let Lervo apply its own verified hunks. A deferred generation
 * writes nothing and leaves the finding for a later cycle.
 */
export async function generateFreshnessCandidate(input: {
  context: FreshnessGenerationContext;
  entry: PrioritizedDocumentFreshnessFinding;
  content: Buffer;
  documentOwnership: DocumentFreshnessOwnership;
  attempt: number;
  policy: DocumentFreshnessPolicy;
  mandateKinds: readonly string[];
  autoApply?: boolean;
  evidenceCursor?: string;
  predecessorCandidateId?: string;
}): Promise<FreshnessFindingOutcome> {
  const { context, entry } = input;
  const storage = context.storage;
  const root = storage.paths.repositoryRoot;
  const now = context.now().toISOString();
  const oracle = filesystemDocumentFreshnessOracle(root);
  const shared = {
    finding: entry.finding,
    priorityClass: entry.priorityClass,
    source: new Uint8Array(input.content),
    currentHash: entry.finding.documentHash,
    documentOwnership: input.documentOwnership,
    evidenceTruncated: false,
    policy: input.policy,
    oracle,
    mandateKinds: input.mandateKinds,
    inboundDocuments: () => inboundMarkdown(root, entry.finding.documentPath),
    now,
  };
  let candidate: DocumentFreshnessCandidateV1;
  let tokensObserved = 0;
  if (!documentFreshnessFindingActionable(entry.finding)) {
    candidate = reviewIntervalOnlyFreshnessCandidate({
      ...shared,
      generationId: stableId("kfg", {
        finding: entry.finding.findingDigest,
        attempt: input.attempt,
      }),
      bundleHash: entry.finding.findingDigest,
    });
    const dependencyWitness = await captureFreshnessDependencies({
      root,
      finding: entry.finding,
      evidence: [],
    });
    if (dependencyWitness !== null && !entry.finding.references.some(freshnessReferenceMissing)) {
      candidate = { ...candidate, dependencyWitness };
      candidate = await settleFreshnessAssessment({
        context,
        candidate,
        revision: entry.finding.currentRevision,
        reviewerIdentity: "lervo/deterministic-reference-and-interval/v1",
      });
    }
  } else {
    const { bundle, evidence } = await buildFreshnessEvidenceBundle({
      repositoryRoot: root,
      finding: entry.finding,
      content: input.content,
      ...(input.evidenceCursor === undefined ? {} : { cursor: input.evidenceCursor }),
    });
    const dependencyWitness = await captureFreshnessDependencies({
      root,
      finding: entry.finding,
      evidence: bundle.evidence,
    });
    if (dependencyWitness !== null) bundle.dependencyWitness = dependencyWitness;
    const stored = await storage.artifacts.put(freshnessBundleBytes(bundle));
    if (bundle.coverage.status !== "ready")
      return {
        status: "evidence_deferred",
        reason:
          bundle.coverage.status === "unavailable"
            ? "freshness_evidence_unavailable"
            : "freshness_evidence_incomplete",
        receiptHash: stored.contentHash,
        nextCursor: bundle.coverage.nextCursor,
      };
    if (
      dependencyWitness === null ||
      !(await freshnessDependenciesCurrent(root, dependencyWitness))
    )
      return {
        status: "evidence_deferred",
        reason: "freshness_evidence_unavailable",
        receiptHash: stored.contentHash,
        nextCursor: null,
      };
    const generationId = stableId("kfg", {
      finding: entry.finding.findingDigest,
      bundle: stored.contentHash,
      attempt: input.attempt,
    });
    const generated = await generateFreshnessProposal({ context, source: bundle, generationId });
    if (generated.status === "deferred") return { status: "deferred", reason: generated.reason };
    tokensObserved =
      generated.usage?.totalTokens ??
      // Unobserved usage is charged at the per-candidate bound so the daily budget stays a ceiling.
      input.policy.maximumTokensPerCandidate;
    candidate = buildDocumentFreshnessCandidate({
      ...shared,
      generationId,
      bundleHash: stored.contentHash,
      proposal:
        generated.status === "generated" ? parseDocumentFreshnessProposal(generated.value) : null,
      evidence,
      evidenceTruncated: bundle.evidenceTruncated,
      tokensObserved,
    });
    candidate = {
      ...candidate,
      dependencyWitness,
      ...(input.predecessorCandidateId === undefined
        ? {}
        : { predecessorCandidateId: input.predecessorCandidateId }),
      ...(candidate.operation === "no_change_needed" && candidate.state === "verified"
        ? { state: "generated" as const }
        : {}),
    };
    if (!(await freshnessDependenciesCurrent(root, dependencyWitness)))
      candidate = {
        ...candidate,
        state: "superseded",
        rejection: {
          reasonCode: "source_changed",
          rejectorKind: "deterministic",
          contestedHunkIds: [],
        },
      };
    candidate = await prepareFreshnessCrossCheck({
      storage,
      candidate,
      source: shared.source,
      evidence,
      now,
    });
  }
  await writeFreshnessCandidate(root, candidate);
  recordFreshnessCandidateOutcome({
    storage,
    candidate,
    documentHash: entry.finding.documentHash,
    occurredAt: now,
  });
  if (freshnessCrossCheckPending(candidate)) {
    const checked = await runFreshnessCrossCheck({
      context,
      candidate,
      maximumTokens: input.policy.maximumTokensPerCandidate,
    });
    candidate = checked.candidate;
    tokensObserved += checked.tokensObserved;
  }
  if (input.autoApply !== false)
    candidate = await applyCrossCheckedFreshnessHunks(context, candidate);
  return { status: "candidate", candidate, tokensObserved };
}
