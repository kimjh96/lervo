import { validateSchema, type KnowledgeStalenessResult } from "@lervo/schemas";

import {
  calculateKnowledgeStalenessResultId,
  calculateVerifiedKnowledgeId,
} from "./integrity.js";
import {
  KnowledgeError,
  type EvaluateKnowledgeStalenessInput,
} from "./types.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/;

function validTimestamp(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || !value.includes("T")) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "The knowledge staleness evaluation time is invalid.",
    );
  }
  return milliseconds;
}

export function evaluateKnowledgeStaleness(
  input: EvaluateKnowledgeStalenessInput,
): KnowledgeStalenessResult {
  if (
    !validateSchema("verifiedKnowledge", input.knowledge).valid ||
    calculateVerifiedKnowledgeId(input.knowledge) !== input.knowledge.knowledgeId ||
    !SHA256.test(input.currentSnapshot.revision) ||
    Object.values(input.currentSnapshot.files).some((hash) => !SHA256.test(hash))
  ) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "The verified knowledge or repository snapshot contract is invalid.",
    );
  }
  const evaluatedAtMs = validTimestamp(input.evaluatedAt);
  const verifiedAtMs = validTimestamp(input.knowledge.verifiedAt);
  if (evaluatedAtMs < verifiedAtMs) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "Staleness cannot be evaluated at a time before verification.",
    );
  }
  const dueAtMs = verifiedAtMs + input.knowledge.reviewIntervalDays * 86_400_000;
  const changedPaths: string[] = [];
  const missingPaths: string[] = [];
  for (const linked of input.knowledge.paths) {
    const currentHash = input.currentSnapshot.files[linked.path];
    if (currentHash === undefined) missingPaths.push(linked.path);
    else if (currentHash !== linked.contentHash) changedPaths.push(linked.path);
  }
  const reviewStale = evaluatedAtMs >= dueAtMs;
  const pathsStale = changedPaths.length > 0 || missingPaths.length > 0;
  const reasons = [
    ...(reviewStale ? ["review_interval_elapsed" as const] : []),
    ...(changedPaths.length > 0 ? ["linked_path_changed" as const] : []),
    ...(missingPaths.length > 0 ? ["linked_path_missing" as const] : []),
  ];
  const content = {
    schemaVersion: 1 as const,
    projectId: input.knowledge.projectId,
    knowledgeId: input.knowledge.knowledgeId,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    status: reviewStale || pathsStale ? "stale" as const : "current" as const,
    verifiedRevision: input.knowledge.verifiedRevision,
    currentRevision: input.currentSnapshot.revision,
    signals: {
      reviewInterval: {
        status: reviewStale ? "stale" as const : "current" as const,
        dueAt: new Date(dueAtMs).toISOString(),
      },
      paths: {
        status: pathsStale ? "stale" as const : "current" as const,
        changedPaths,
        missingPaths,
      },
    },
    reasons,
  };
  const result = {
    ...content,
    resultId: calculateKnowledgeStalenessResultId(
      content as Omit<KnowledgeStalenessResult, "resultId">,
    ),
  } as KnowledgeStalenessResult;
  if (!validateSchema("knowledgeStalenessResult", result).valid) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "The generated knowledge staleness result does not satisfy the schema.",
    );
  }
  return result;
}

export function validateKnowledgeStalenessResult(result: KnowledgeStalenessResult): void {
  const reviewStale = result.signals.reviewInterval.status === "stale";
  const pathsStale = result.signals.paths.status === "stale";
  const hasChanged = result.signals.paths.changedPaths.length > 0;
  const hasMissing = result.signals.paths.missingPaths.length > 0;
  const expectedReasons = [
    ...(reviewStale ? ["review_interval_elapsed"] : []),
    ...(hasChanged ? ["linked_path_changed"] : []),
    ...(hasMissing ? ["linked_path_missing"] : []),
  ];
  if (
    !validateSchema("knowledgeStalenessResult", result).valid ||
    calculateKnowledgeStalenessResultId(result) !== result.resultId ||
    pathsStale !== (hasChanged || hasMissing) ||
    (result.status === "stale") !== (reviewStale || pathsStale) ||
    JSON.stringify(result.reasons) !== JSON.stringify(expectedReasons)
  ) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "The knowledge staleness result status, signals, and reasons do not agree.",
    );
  }
}
