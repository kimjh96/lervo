import { canonicalJson, sha256 } from "./integrity.js";
import { supplementalEvidenceUnit, wholeSourceUnit } from "./repository-source-units.js";
import {
  compareScanPaths,
  knowledgeScanPriorityClass,
  scanPriorityClasses,
} from "./scan-priority.js";
import type {
  RepositoryKnowledgeScan,
  RepositoryScanPriorityClass,
  RepositorySource,
  RepositorySourceUnit,
  RepositorySupplementalSource,
} from "./types.js";

export interface ScanRetentionCandidate {
  path: string;
  byteCount: number;
  priority: RepositoryScanPriorityClass;
  /** One validating read. Its text stays in memory only when the budget retains the source. */
  read: () => Promise<RepositorySource | null>;
  supplemental?: RepositorySupplementalSource;
}

export interface ScanRetentionResult {
  sources: RepositorySource[];
  /** Whole-source units of observed-only sources, computed before their text was released. */
  observedUnits: RepositorySourceUnit[];
  coverage: RepositoryKnowledgeScan["coverage"];
  skippedForBudget: RepositoryKnowledgeScan["skippedForBudget"];
  retention: RepositoryKnowledgeScan["retention"];
}

export function observedOnlySource(source: RepositorySource): boolean {
  return source.contentRetention === "observed_only";
}

/**
 * ADR-0544: every eligible source is read and hashed; `maxTotalBytes` bounds only the text kept in
 * memory, spent in retention order with code-point path order inside each class. Coverage is
 * complete when no knowledge-class source (classes 1–4) had to be released.
 */
export async function admitRetainedContent(input: {
  projectId: string;
  maxTotalBytes: number;
  candidates: readonly ScanRetentionCandidate[];
}): Promise<ScanRetentionResult> {
  const ordered = [...input.candidates].sort(
    (left, right) =>
      scanPriorityClasses.indexOf(left.priority) - scanPriorityClasses.indexOf(right.priority) ||
      compareScanPaths(left.path, right.path),
  );
  const sources: RepositorySource[] = [];
  const observedUnits: RepositorySourceUnit[] = [];
  const observedClasses = new Set<RepositoryScanPriorityClass>();
  let retainedBytes = 0;
  let observedCount = 0;
  let observedBytes = 0;
  for (const candidate of ordered) {
    const retain = retainedBytes + candidate.byteCount <= input.maxTotalBytes;
    const source = await candidate.read();
    if (source === null) continue;
    if (source.status !== "included" || retain) {
      sources.push(source);
      if (source.status === "included") retainedBytes += source.byteCount;
      continue;
    }
    const { content, ...metadata } = source;
    if (content !== undefined && source.contentHash !== null) {
      const readable = { ...source, content, contentHash: source.contentHash };
      observedUnits.push(
        candidate.supplemental === undefined
          ? wholeSourceUnit(input.projectId, readable)
          : supplementalEvidenceUnit(input.projectId, readable, candidate.supplemental),
      );
    }
    sources.push({ ...metadata, contentRetention: "observed_only" });
    observedCount += 1;
    observedBytes += source.byteCount;
    observedClasses.add(candidate.priority);
  }
  const classes = scanPriorityClasses.filter((value) => observedClasses.has(value));
  return {
    sources,
    observedUnits,
    coverage: classes.some(knowledgeScanPriorityClass) ? "partial" : "complete",
    skippedForBudget: { count: observedCount, bytes: observedBytes, classes: [...classes] },
    retention: { observedOnly: { count: observedCount, bytes: observedBytes, classes } },
  };
}

/**
 * Binds projections whose value depends on extracted units to the set of sources whose text was
 * not retained, so observed-only and fully retained scans never share an entry.
 */
export function scanRetentionDigest(scan: Pick<RepositoryKnowledgeScan, "sources">): string {
  return sha256(
    canonicalJson(
      scan.sources
        .filter(observedOnlySource)
        .map((source) => source.path)
        .sort(compareScanPaths),
    ),
  );
}
