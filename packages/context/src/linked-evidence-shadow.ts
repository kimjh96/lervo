import { createHash } from "node:crypto";
import path from "node:path";

import { SHA256_PATTERN, SOURCE_ID_PATTERN, safeRepositoryPath } from "@lervo/search";

export const linkedEvidenceShadowPolicy = {
  id: "linked-evidence-shadow",
  version: 1,
  maximumDepth: 1,
  maximumRecommendations: 3,
  maximumLinkedSources: 8,
  maximumLinkedSourceBytes: 65_536,
  ordering: "recommendation_then_link_occurrence_prefix_v1",
} as const;

export type LinkedEvidenceShadowFailureCode =
  "shadow_bound_invalid" | "shadow_contract_invalid" | "shadow_source_unavailable";

export class LinkedEvidenceShadowError extends Error {
  constructor(
    readonly code: LinkedEvidenceShadowFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "LinkedEvidenceShadowError";
  }
}

export interface LinkedEvidenceShadowSource {
  documentId: string;
  path: string;
  contentHash: string;
  text: string;
}

export interface LinkedEvidenceShadowProjection {
  policy: typeof linkedEvidenceShadowPolicy;
  sourceSnapshotId: string;
  projectionDigest: string;
  sources: LinkedEvidenceShadowSource[];
  selectedPaths: string[];
  links: Array<{ linkedFromPath: string; linkedPath: string }>;
  candidateCount: number;
  ignoredCount: number;
  truncated: boolean;
  byteCount: number;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function contentDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function invalid(code: LinkedEvidenceShadowFailureCode, message: string): never {
  throw new LinkedEvidenceShadowError(code, message);
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
    invalid("shadow_source_unavailable", "A linked-evidence source is invalid or unsafe.");
  }
}

function inlineMarkdownTargets(content: string): string[] {
  return [...content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)].map((match) => match[1]!);
}

function corpusRelativeTarget(originPath: string, rawTarget: string): string | null {
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

export function projectLinkedEvidenceShadow(input: {
  corpus: readonly LinkedEvidenceShadowSource[];
  recommendations: readonly LinkedEvidenceShadowSource[];
  existingPaths: readonly string[];
}): LinkedEvidenceShadowProjection {
  if (input.recommendations.length > linkedEvidenceShadowPolicy.maximumRecommendations) {
    invalid("shadow_bound_invalid", "The linked-evidence recommendation bound was exceeded.");
  }
  if (input.existingPaths.some((sourcePath) => !safeRepositoryPath(sourcePath))) {
    invalid("shadow_contract_invalid", "An existing linked-evidence path is invalid or unsafe.");
  }
  const corpusByPath = new Map<string, LinkedEvidenceShadowSource>();
  const corpusDocumentIds = new Set<string>();
  for (const source of input.corpus) {
    assertSource(source);
    if (corpusByPath.has(source.path) || corpusDocumentIds.has(source.documentId)) {
      invalid("shadow_contract_invalid", "The linked-evidence corpus contains a duplicate source.");
    }
    corpusByPath.set(source.path, source);
    corpusDocumentIds.add(source.documentId);
  }
  for (const recommendation of input.recommendations) {
    assertSource(recommendation);
    const source = corpusByPath.get(recommendation.path);
    if (
      source === undefined ||
      source.documentId !== recommendation.documentId ||
      source.contentHash !== recommendation.contentHash ||
      source.text !== recommendation.text
    ) {
      invalid(
        "shadow_source_unavailable",
        "A linked-evidence recommendation differs from the current registered corpus.",
      );
    }
  }
  const existingPaths = new Set(input.existingPaths);
  const seen = new Set<string>();
  const candidates: Array<{
    source: LinkedEvidenceShadowSource;
    linkedFromPath: string;
  }> = [];
  let ignoredCount = 0;
  for (const recommendation of input.recommendations) {
    for (const rawTarget of inlineMarkdownTargets(recommendation.text)) {
      const targetPath = corpusRelativeTarget(recommendation.path, rawTarget);
      const source = targetPath === null ? undefined : corpusByPath.get(targetPath);
      if (source === undefined || existingPaths.has(source.path) || seen.has(source.path)) {
        ignoredCount += 1;
        continue;
      }
      seen.add(source.path);
      candidates.push({ source, linkedFromPath: recommendation.path });
    }
  }
  const selected: typeof candidates = [];
  let byteCount = 0;
  for (const candidate of candidates) {
    const sourceBytes = new TextEncoder().encode(candidate.source.text).byteLength;
    if (
      selected.length === linkedEvidenceShadowPolicy.maximumLinkedSources ||
      byteCount + sourceBytes > linkedEvidenceShadowPolicy.maximumLinkedSourceBytes
    ) {
      break;
    }
    selected.push(candidate);
    byteCount += sourceBytes;
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
  const coordinates = selected.map(({ source, linkedFromPath }) => ({
    documentId: source.documentId,
    contentHash: source.contentHash,
    linkedFromPath,
    linkedPath: source.path,
  }));
  return {
    policy: linkedEvidenceShadowPolicy,
    sourceSnapshotId,
    projectionDigest: digest({
      policy: linkedEvidenceShadowPolicy,
      sourceSnapshotId,
      recommendations: input.recommendations.map(({ documentId, contentHash }) => ({
        documentId,
        contentHash,
      })),
      coordinates,
      candidateCount: candidates.length,
      ignoredCount,
      byteCount,
    }),
    sources: selected.map(({ source }) => ({ ...source })),
    selectedPaths: selected.map(({ source }) => source.path),
    links: selected.map(({ source, linkedFromPath }) => ({
      linkedFromPath,
      linkedPath: source.path,
    })),
    candidateCount: candidates.length,
    ignoredCount,
    truncated: selected.length < candidates.length,
    byteCount,
  };
}
