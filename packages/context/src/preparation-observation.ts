import { instructionReportConsistent } from "./instruction-observation.js";
import { unavailableContextQualityBindings } from "./quality-readiness.js";
import { createHash } from "node:crypto";

import {
  contextPreparationReasonCodes,
  validateSchema,
  type ContextPreparationReasonCode,
  type ContextPreparationReport,
} from "@lervo/schemas";

export interface PreparationSource {
  sourceId: string;
  contentHash: string;
}

export interface PreparationLoad extends PreparationSource {
  disposition: "full" | "prefix" | "unavailable";
  preparedByteCount: number;
  reason: ContextPreparationReasonCode | null;
}

export interface PreparationObservationInput {
  requestDigest: string;
  corpusCoverage?: "unobserved" | "incomplete";
  sourceSnapshotId: string | null;
  retrieval: "completed" | "not_run" | "unavailable";
  candidateCount: number | null;
  selected: readonly PreparationSource[];
  /** Null means this operation does not observe final context loading. */
  loads: readonly PreparationLoad[] | null;
}

function invalid(): never {
  // Do not include caller text, paths, or source content in diagnostics.
  throw new TypeError("Invalid context preparation observation.");
}

/** Readers preserve historical activation receipts, but must not promote malformed diagnostics. */
export function isContextPreparationReport(value: unknown): value is ContextPreparationReport {
  if (!validateSchema("contextPreparationReport", value).valid) return false;
  const report = value as ContextPreparationReport;
  if (report.instructions !== undefined && !instructionReportConsistent(report.instructions))
    return false;
  if (report.retrieval === "completed") {
    if (report.candidateCount === null || report.candidateCount < report.selectedCount)
      return false;
  } else if (report.candidateCount !== null || report.selectedCount !== 0) return false;
  if (report.loading === "unobserved") {
    if (
      [
        report.fullCount,
        report.prefixCount,
        report.unavailableCount,
        report.preparedByteCount,
      ].some((count) => count !== null)
    )
      return false;
  } else {
    if (
      report.fullCount === null ||
      report.prefixCount === null ||
      report.unavailableCount === null ||
      report.preparedByteCount === null ||
      report.fullCount + report.prefixCount + report.unavailableCount !== report.selectedCount ||
      report.preparedByteCount > (report.fullCount + report.prefixCount) * 131072 ||
      report.preparedByteCount < report.prefixCount
    )
      return false;
  }
  const conditions = [
    ["retrieval_not_run", report.retrieval === "not_run"],
    ["retrieval_unavailable", report.retrieval === "unavailable"],
    ["loading_unobserved", report.loading === "unobserved"],
    ["corpus_incomplete", report.corpusCoverage === "incomplete"],
    ["prefix_only", report.prefixCount !== null && report.prefixCount > 0],
  ] as const;
  if (conditions.some(([reason, expected]) => report.reasonCodes.includes(reason) !== expected))
    return false;
  const loadFailures = report.reasonCodes.filter(
    (reason) => reason.startsWith("source_") || reason === "capacity_exhausted",
  );
  return (
    loadFailures.length > 0 === (report.unavailableCount !== null && report.unavailableCount > 0)
  );
}

function sourceKey(source: PreparationSource): string {
  if (
    typeof source.sourceId !== "string" ||
    source.sourceId.length > 128 ||
    typeof source.contentHash !== "string" ||
    source.contentHash.length !== 71 ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(source.sourceId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(source.contentHash)
  )
    invalid();
  return `${source.sourceId}:${source.contentHash}`;
}

/** Pure bounded projection. A completed retrieval never establishes policy or corpus coverage. */
export function observeContextPreparation(
  input: PreparationObservationInput,
): ContextPreparationReport {
  if (
    typeof input.requestDigest !== "string" ||
    input.requestDigest.length !== 71 ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.requestDigest) ||
    (input.sourceSnapshotId !== null &&
      (typeof input.sourceSnapshotId !== "string" ||
        input.sourceSnapshotId.length > 128 ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(input.sourceSnapshotId))) ||
    !["completed", "not_run", "unavailable"].includes(input.retrieval) ||
    (input.corpusCoverage !== undefined &&
      !["unobserved", "incomplete"].includes(input.corpusCoverage)) ||
    (input.candidateCount !== null &&
      (!Number.isSafeInteger(input.candidateCount) ||
        input.candidateCount < 0 ||
        input.candidateCount > 50)) ||
    !Array.isArray(input.selected) ||
    input.selected.length > 50 ||
    (input.loads !== null && (!Array.isArray(input.loads) || input.loads.length > 50))
  )
    invalid();
  const selected = input.selected.map((source) => ({
    sourceId: source.sourceId,
    contentHash: source.contentHash,
  }));
  const keys = new Set(selected.map(sourceKey));
  if (
    keys.size !== selected.length ||
    new Set(selected.map((s) => s.sourceId)).size !== selected.length
  )
    invalid();
  if (input.retrieval === "completed") {
    if (input.candidateCount === null || input.candidateCount < selected.length) invalid();
  } else if (input.candidateCount !== null || selected.length !== 0) invalid();

  const reasons = new Set<ContextPreparationReasonCode>();
  if (input.retrieval === "not_run") reasons.add("retrieval_not_run");
  if (input.retrieval === "unavailable") reasons.add("retrieval_unavailable");
  if (input.loads === null) reasons.add("loading_unobserved");
  if (input.corpusCoverage === "incomplete") reasons.add("corpus_incomplete");
  const loadedKeys = new Set<string>();
  const loads =
    input.loads?.map((load) => {
      const key = sourceKey(load);
      if (!keys.has(key) || loadedKeys.has(key) || !Number.isSafeInteger(load.preparedByteCount))
        invalid();
      loadedKeys.add(key);
      if (load.disposition === "unavailable") {
        if (
          load.preparedByteCount !== 0 ||
          load.reason === null ||
          !contextPreparationReasonCodes.includes(load.reason) ||
          [
            "retrieval_not_run",
            "retrieval_unavailable",
            "loading_unobserved",
            "corpus_incomplete",
            "prefix_only",
          ].includes(load.reason)
        )
          invalid();
      } else {
        if (
          !["full", "prefix"].includes(load.disposition) ||
          load.preparedByteCount < 0 ||
          load.preparedByteCount > 131072 ||
          (load.disposition === "prefix" && load.preparedByteCount === 0) ||
          load.reason !== (load.disposition === "prefix" ? "prefix_only" : null)
        )
          invalid();
      }
      if (load.reason !== null) reasons.add(load.reason);
      return {
        sourceId: load.sourceId,
        contentHash: load.contentHash,
        disposition: load.disposition,
        preparedByteCount: load.preparedByteCount,
        reason: load.reason,
      };
    }) ?? null;
  if (loads !== null && loads.length !== selected.length) invalid();
  // Loading completion order is incidental; selection order remains semantically significant.
  const orderedLoads =
    loads === null ? null : selected.map((s) => loads.find((l) => sourceKey(l) === sourceKey(s))!);
  const observation = {
    requestDigest: input.requestDigest,
    sourceSnapshotId: input.sourceSnapshotId,
    corpusCoverage: input.corpusCoverage ?? "unobserved",
    retrieval: input.retrieval,
    candidateCount: input.candidateCount,
    selected,
    loads: orderedLoads,
  };
  const report: ContextPreparationReport = {
    planningReadiness: unavailableContextQualityBindings(),
    schemaVersion: 1,
    contractId: "context_preparation_observation_v1",
    requestDigest: input.requestDigest,
    sourceSnapshotId: input.sourceSnapshotId,
    observationDigest: `sha256:${createHash("sha256").update(JSON.stringify(observation)).digest("hex")}`,
    retrieval: input.retrieval,
    candidateCount: input.candidateCount,
    selectedCount: selected.length,
    loading: loads === null ? "unobserved" : "observed",
    fullCount: loads?.filter((l) => l.disposition === "full").length ?? null,
    prefixCount: loads?.filter((l) => l.disposition === "prefix").length ?? null,
    unavailableCount: loads?.filter((l) => l.disposition === "unavailable").length ?? null,
    preparedByteCount: loads?.reduce((sum, l) => sum + l.preparedByteCount, 0) ?? null,
    reasonCodes: [...reasons].sort(),
    applicability: "unobserved",
    corpusCoverage: input.corpusCoverage ?? "unobserved",
    delivery: "unobserved",
    internalUse: "unknown",
    artifactCompliance: "unobserved",
  };
  if (!isContextPreparationReport(report)) invalid();
  return report;
}
