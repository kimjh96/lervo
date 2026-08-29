import { createHash } from "node:crypto";
import path from "node:path";

import { SHA256_PATTERN, SOURCE_ID_PATTERN, safeRepositoryPath } from "@lervo/search";

import type { LinkedEvidenceShadowSource } from "./linked-evidence-shadow.js";
import type { ManagedLinkedEvidenceSelection } from "./types.js";

export const managedLinkedEvidenceCanaryPolicy = {
  id: "linked-evidence-managed-canary-v1",
  version: 1,
  enabledByDefault: false,
  maximumDepth: 1,
  maximumRecommendations: 3,
  maximumCandidates: 8,
  maximumProviderVisibleSourceBytes: 117_813,
  maximumSelectionCalls: 1,
  selectionProtocolId: "linked-evidence-provider-shadow-relational-coverage-v17",
} as const;

export const managedLinkedEvidenceSelectionProtocol = [
  "Select only evidence needed to perform or decide the current request.",
  "Use only the supplied source bodies and return their exact evidence tokens.",
  "First identify each request-scoped claim, authority boundary, prerequisite, and operational instruction.",
  "For comparisons, reconciliation, merges, or conflicts, keep a direct source for every distinct side.",
  "A later decision does not subsume the prerequisite, conflict boundary, or authority that makes it valid.",
  "After coverage is complete, remove a source only when every required item remains directly supported.",
  "Exclude adjacent, historical, downstream, or general background that supports no required current-phase item.",
].join("\n");

export const managedLinkedEvidenceSelectionProtocolDigest = `sha256:${createHash("sha256")
  .update(managedLinkedEvidenceSelectionProtocol)
  .digest("hex")}`;

export const managedLinkedEvidenceDeterministicSelectionPolicy = {
  kind: "deterministic_all_current_linked_candidates_v1",
  policyId: "managed-linked-evidence-all-candidates-v1",
  rule: "select_all_current_managed_linked_candidates_in_projection_order",
  maximumCandidates: managedLinkedEvidenceCanaryPolicy.maximumCandidates,
  digest: "sha256:8063ff4d0c1825b3abe35f81a53f245b988b8c6ea1e0cdacf2a690bbea76cb18",
} as const;

export const managedLinkedEvidenceDefaultPolicy = {
  id: "managed-linked-evidence-default-v1",
  version: 1,
  enabledByDefault: true,
  selectionRuleId: "managed_linked_evidence_default",
  selectionPolicy: managedLinkedEvidenceDeterministicSelectionPolicy,
  maximumCandidates: managedLinkedEvidenceCanaryPolicy.maximumCandidates,
  maximumProviderVisibleSourceBytes:
    managedLinkedEvidenceCanaryPolicy.maximumProviderVisibleSourceBytes,
  maximumSelectionCalls: 0,
} as const;

export type ManagedLinkedEvidenceCanaryFailureCode =
  | "canary_not_eligible"
  | "canary_selection_unavailable"
  | "canary_selection_invalid"
  | "canary_source_changed"
  | "canary_delivery_unconfirmed"
  | "canary_evidence_incomplete"
  | "canary_storage_failed";

export class ManagedLinkedEvidenceCanaryError extends Error {
  constructor(
    readonly code: ManagedLinkedEvidenceCanaryFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedLinkedEvidenceCanaryError";
  }
}

export interface ManagedLinkedEvidenceCanaryCandidate extends LinkedEvidenceShadowSource {
  byteCount: number;
  token: string;
  linkedFromPath: string;
}

export interface ManagedLinkedEvidenceCanaryProjection {
  policy: typeof managedLinkedEvidenceCanaryPolicy;
  sourceSnapshotId: string;
  projectionDigest: string;
  candidates: ManagedLinkedEvidenceCanaryCandidate[];
  candidateCount: number;
  ignoredCount: number;
  providerVisibleSourceBytes: number;
  truncated: boolean;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function contentDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSource(source: LinkedEvidenceShadowSource): void {
  if (
    !SOURCE_ID_PATTERN.test(source.documentId) ||
    !safeRepositoryPath(source.path) ||
    !SHA256_PATTERN.test(source.contentHash) ||
    typeof source.text !== "string" ||
    contentDigest(source.text) !== source.contentHash
  ) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_source_changed",
      "A managed linked-evidence source is missing, unsafe, or changed.",
    );
  }
}

function inlineMarkdownTargets(content: string): string[] {
  return [...content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)].map((match) => match[1]!);
}

function repositoryTarget(originPath: string, rawTarget: string): string | null {
  let target = rawTarget;
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  target = target.split("#", 1)[0]!.split("?", 1)[0]!;
  if (target.length === 0 || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    return null;
  }
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(originPath), target));
  return resolved === ".." || resolved.startsWith("../") ? null : resolved;
}

export function projectManagedLinkedEvidenceCanary(input: {
  corpus: readonly LinkedEvidenceShadowSource[];
  recommendations: readonly LinkedEvidenceShadowSource[];
  existingPaths: readonly string[];
}): ManagedLinkedEvidenceCanaryProjection {
  if (input.recommendations.length > managedLinkedEvidenceCanaryPolicy.maximumRecommendations) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_not_eligible",
      "The managed recommendation bound was exceeded.",
    );
  }
  const corpusByPath = new Map<string, LinkedEvidenceShadowSource>();
  const documentIds = new Set<string>();
  for (const source of input.corpus) {
    assertSource(source);
    if (corpusByPath.has(source.path) || documentIds.has(source.documentId)) {
      throw new ManagedLinkedEvidenceCanaryError(
        "canary_source_changed",
        "The registered managed linked-evidence corpus is duplicated.",
      );
    }
    corpusByPath.set(source.path, source);
    documentIds.add(source.documentId);
  }
  for (const recommendation of input.recommendations) {
    assertSource(recommendation);
    const registered = corpusByPath.get(recommendation.path);
    if (
      registered === undefined ||
      registered.documentId !== recommendation.documentId ||
      registered.contentHash !== recommendation.contentHash ||
      registered.text !== recommendation.text
    ) {
      throw new ManagedLinkedEvidenceCanaryError(
        "canary_source_changed",
        "A managed recommendation differs from the registered corpus.",
      );
    }
  }
  if (input.existingPaths.some((item) => !safeRepositoryPath(item))) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_not_eligible",
      "An existing managed context path is unsafe.",
    );
  }
  const existingPaths = new Set(input.existingPaths);
  const seen = new Set<string>();
  const discovered: Array<{ source: LinkedEvidenceShadowSource; linkedFromPath: string }> = [];
  let ignoredCount = 0;
  for (const recommendation of input.recommendations) {
    for (const rawTarget of inlineMarkdownTargets(recommendation.text)) {
      const target = repositoryTarget(recommendation.path, rawTarget);
      const source = target === null ? undefined : corpusByPath.get(target);
      if (source === undefined || existingPaths.has(source.path) || seen.has(source.path)) {
        ignoredCount += 1;
        continue;
      }
      seen.add(source.path);
      discovered.push({ source, linkedFromPath: recommendation.path });
    }
  }
  const candidates: ManagedLinkedEvidenceCanaryCandidate[] = [];
  let providerVisibleSourceBytes = 0;
  for (const item of discovered) {
    const byteCount = new TextEncoder().encode(item.source.text).byteLength;
    if (
      candidates.length === managedLinkedEvidenceCanaryPolicy.maximumCandidates ||
      providerVisibleSourceBytes + byteCount >
        managedLinkedEvidenceCanaryPolicy.maximumProviderVisibleSourceBytes
    ) {
      break;
    }
    providerVisibleSourceBytes += byteCount;
    candidates.push({
      ...item.source,
      byteCount,
      token: `lervo-e4:${item.source.documentId}:${item.source.contentHash}`,
      linkedFromPath: item.linkedFromPath,
    });
  }
  const sourceSnapshotId = digest(
    [...input.corpus]
      .sort((left, right) => compareText(left.path, right.path))
      .map(({ documentId, path: sourcePath, contentHash }) => ({
        documentId,
        path: sourcePath,
        contentHash,
      })),
  );
  const projectionDigest = digest({
    policy: managedLinkedEvidenceCanaryPolicy,
    sourceSnapshotId,
    recommendations: input.recommendations.map(({ documentId, contentHash }) => ({
      documentId,
      contentHash,
    })),
    candidates: candidates.map(({ documentId, contentHash, linkedFromPath }) => ({
      documentId,
      contentHash,
      linkedFromPath,
    })),
    candidateCount: discovered.length,
    ignoredCount,
    providerVisibleSourceBytes,
  });
  return {
    policy: managedLinkedEvidenceCanaryPolicy,
    sourceSnapshotId,
    projectionDigest,
    candidates,
    candidateCount: discovered.length,
    ignoredCount,
    providerVisibleSourceBytes,
    truncated: candidates.length < discovered.length,
  };
}

export function managedLinkedEvidenceSelectionSchema(
  candidates: readonly ManagedLinkedEvidenceCanaryCandidate[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      evidenceTokens: {
        type: "array",
        items: { type: "string", enum: candidates.map((candidate) => candidate.token) },
        maxItems: managedLinkedEvidenceCanaryPolicy.maximumCandidates,
      },
    },
    required: ["evidenceTokens"],
    additionalProperties: false,
  };
}

export function parseManagedLinkedEvidenceSelection(input: {
  content: string;
  candidates: readonly ManagedLinkedEvidenceCanaryCandidate[];
  selectionAttemptId: string;
}): ManagedLinkedEvidenceSelection[] {
  let value: unknown;
  try {
    value = JSON.parse(input.content);
  } catch (error) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_selection_invalid",
      "The managed linked-evidence selection is not JSON.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["evidenceTokens"]) ||
    !Array.isArray((value as { evidenceTokens?: unknown }).evidenceTokens) ||
    !(value as { evidenceTokens: unknown[] }).evidenceTokens.every(
      (token) => typeof token === "string",
    )
  ) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_selection_invalid",
      "The managed linked-evidence selection has an invalid shape.",
    );
  }
  const tokens = (value as { evidenceTokens: string[] }).evidenceTokens;
  const byToken = new Map(input.candidates.map((candidate) => [candidate.token, candidate]));
  if (
    tokens.length > managedLinkedEvidenceCanaryPolicy.maximumCandidates ||
    new Set(tokens).size !== tokens.length ||
    tokens.some((token) => !byToken.has(token))
  ) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_selection_invalid",
      "The managed linked-evidence selection is unknown, duplicated, or excessive.",
    );
  }
  return tokens.map((token, index) => {
    const candidate = byToken.get(token)!;
    return {
      schemaVersion: 1,
      selectionAttemptId: input.selectionAttemptId,
      documentId: candidate.documentId,
      path: candidate.path,
      contentHash: candidate.contentHash,
      rank: index + 1,
    };
  });
}
