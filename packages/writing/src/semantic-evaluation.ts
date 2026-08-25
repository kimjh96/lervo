import { canonicalJson } from "@lervo/event-contract";
import type { WritingCheckResult, WritingContract } from "@lervo/schemas";

import { writingSha256 } from "./integrity.js";
import type {
  SemanticEvaluationStatus,
  SemanticWritingEvaluationResponse,
  WritingArtifactCoordinate,
  WritingSemanticEvaluator,
} from "./types.js";

export interface SemanticEvaluationOutcome {
  status: SemanticEvaluationStatus;
  evaluator: { kind: "model" | "human"; evaluatorId: string; phase: "separate_pass" } | null;
  checks: WritingCheckResult[];
}

function notRunChecks(contract: WritingContract): WritingCheckResult[] {
  return contract.verification.semanticChecks.map((check) => ({
    checkId: check.checkId,
    kind: "semantic",
    status: "not_run",
    violationCount: 0,
    evidenceDigest: null,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseIsValid(
  response: unknown,
  requiredIds: readonly string[],
): response is SemanticWritingEvaluationResponse {
  if (
    !isRecord(response) ||
    !isRecord(response.evaluator) ||
    !Array.isArray(response.checks) ||
    (response.evaluator.kind !== "model" && response.evaluator.kind !== "human") ||
    typeof response.evaluator.evaluatorId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,149}$/.test(response.evaluator.evaluatorId) ||
    response.checks.length !== requiredIds.length
  )
    return false;
  const seen = new Set<string>();
  for (const check of response.checks) {
    if (
      !isRecord(check) ||
      typeof check.checkId !== "string" ||
      !requiredIds.includes(check.checkId) ||
      seen.has(check.checkId) ||
      (check.status !== "passed" && check.status !== "failed") ||
      typeof check.violationCount !== "number" ||
      !Number.isSafeInteger(check.violationCount) ||
      check.violationCount < 0 ||
      (check.status === "passed" && check.violationCount !== 0) ||
      (check.status === "failed" && check.violationCount === 0)
    )
      return false;
    seen.add(check.checkId);
  }
  return true;
}

export async function runSemanticEvaluation(input: {
  content: string;
  artifact: WritingArtifactCoordinate;
  contract: WritingContract;
  surface: Parameters<WritingSemanticEvaluator["evaluate"]>[0]["surface"];
  evaluator?: WritingSemanticEvaluator;
  deterministicPassed: boolean;
}): Promise<SemanticEvaluationOutcome> {
  if (!input.deterministicPassed || input.evaluator === undefined) {
    return { status: "not_run", evaluator: null, checks: notRunChecks(input.contract) };
  }
  const required = input.contract.verification.semanticChecks.filter((check) => check.required);
  let response: unknown;
  try {
    response = await input.evaluator.evaluate({
      writingPolicyId: input.contract.writingPolicyId,
      locale: input.contract.locale,
      surface: input.surface,
      audience: input.contract.audience,
      register: input.contract.prose.register,
      artifactId: input.artifact.artifactId,
      contentHash: input.artifact.contentHash,
      content: input.content,
      checks: required.map(({ checkId, requirement }) => ({ checkId, requirement })),
    });
  } catch {
    return { status: "failed", evaluator: null, checks: notRunChecks(input.contract) };
  }
  if (
    !responseIsValid(
      response,
      required.map((check) => check.checkId),
    )
  ) {
    return { status: "invalid", evaluator: null, checks: notRunChecks(input.contract) };
  }
  const evaluator = { ...response.evaluator, phase: "separate_pass" as const };
  const checksById = new Map(response.checks.map((check) => [check.checkId, check]));
  return {
    status: "completed",
    evaluator,
    checks: required
      .map(({ checkId }) => checksById.get(checkId)!)
      .map((check) => ({
        ...check,
        kind: "semantic" as const,
        evidenceDigest: writingSha256(
          canonicalJson({
            evaluator,
            artifactId: input.artifact.artifactId,
            contentHash: input.artifact.contentHash,
            check,
          }),
        ),
      })),
  };
}
