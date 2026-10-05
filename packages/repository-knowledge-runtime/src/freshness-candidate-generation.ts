import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildDocumentFreshnessCandidate,
  documentFreshnessAutoApplicableHunks,
  documentFreshnessFindingActionable,
  filesystemDocumentFreshnessOracle,
  parseDocumentFreshnessProposal,
  reviewIntervalOnlyFreshnessCandidate,
  stableId,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessOwnership,
  type DocumentFreshnessPolicy,
  type PrioritizedDocumentFreshnessFinding,
} from "@lervo/repository-knowledge";

import { applyLervoManagedFreshnessHunks } from "./freshness-apply.js";
import { buildFreshnessEvidenceBundle, freshnessBundleBytes } from "./freshness-evidence-bundle.js";
import { recordFreshnessCandidateOutcome } from "./freshness-events.js";
import {
  generateFreshnessProposal,
  type FreshnessGenerationContext,
} from "./freshness-generation.js";
import { writeFreshnessCandidate } from "./freshness-state-store.js";

const MAXIMUM_INBOUND_DOCUMENTS = 8_192;

export type FreshnessFindingOutcome =
  | { status: "deferred"; reason: string }
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
 * governed provider call, build and verify the candidate, record its events, and let Lervo apply
 * its own verified hunks. A deferred call writes nothing and leaves the finding for a later cycle.
 */
export async function generateFreshnessCandidate(input: {
  context: FreshnessGenerationContext;
  entry: PrioritizedDocumentFreshnessFinding;
  content: Buffer;
  documentOwnership: DocumentFreshnessOwnership;
  attempt: number;
  policy: DocumentFreshnessPolicy;
  mandateKinds: readonly string[];
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
  } else {
    const { bundle, evidence } = await buildFreshnessEvidenceBundle({
      repositoryRoot: root,
      finding: entry.finding,
      content: input.content,
    });
    const stored = await storage.artifacts.put(freshnessBundleBytes(bundle));
    const generationId = stableId("kfg", {
      finding: entry.finding.findingDigest,
      bundle: stored.contentHash,
      attempt: input.attempt,
    });
    const generated = await generateFreshnessProposal({ context, bundle, generationId });
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
      tokensObserved: generated.usage?.totalTokens ?? 0,
    });
  }
  await writeFreshnessCandidate(root, candidate);
  recordFreshnessCandidateOutcome({
    storage,
    candidate,
    documentHash: entry.finding.documentHash,
    occurredAt: now,
  });
  const automatic = documentFreshnessAutoApplicableHunks(candidate);
  if (candidate.state === "verified" && candidate.operation === "edit" && automatic.length > 0)
    candidate = await applyLervoManagedFreshnessHunks({
      storage,
      candidate,
      hunkIds: new Set(automatic.map((hunk) => hunk.hunkId)),
      now: context.now(),
    });
  return { status: "candidate", candidate, tokensObserved };
}
