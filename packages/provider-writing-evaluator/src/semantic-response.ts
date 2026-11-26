import type {
  SemanticWritingEvaluationRequest,
  SemanticWritingEvaluationResponse,
} from "@lervo/writing";
import { providerOutputSchema, type ProviderOutputSchema } from "@lervo/schemas";

export function providerSemanticEvaluationSchema(
  request: SemanticWritingEvaluationRequest,
): ProviderOutputSchema {
  return providerOutputSchema({
    type: "object",
    additionalProperties: false,
    required: ["checks"],
    properties: {
      checks: {
        type: "array",
        minItems: request.checks.length,
        maxItems: request.checks.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["checkId", "status", "violationCount"],
          properties: {
            checkId: { type: "string", enum: request.checks.map((check) => check.checkId) },
            status: { type: "string", enum: ["passed", "failed"] },
            violationCount: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  });
}

export function parseProviderSemanticEvaluation(
  content: string,
  request: SemanticWritingEvaluationRequest,
  provider: string,
): SemanticWritingEvaluationResponse {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error("The semantic writing evaluation is not a JSON object.", { cause: error });
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["checks"])
  ) {
    throw new Error("The semantic writing evaluation contains invalid fields.");
  }
  const checks = (value as { checks?: unknown }).checks;
  if (!Array.isArray(checks) || checks.length !== request.checks.length) {
    throw new Error("The semantic writing evaluation does not include every required check.");
  }
  const normalized = checks.map((check, index) => {
    if (
      check === null ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      JSON.stringify(Object.keys(check).sort()) !==
        JSON.stringify(["checkId", "status", "violationCount"].sort())
    ) {
      throw new Error("A semantic writing evaluation check has an invalid shape.");
    }
    const item = check as { checkId?: unknown; status?: unknown; violationCount?: unknown };
    const expected = request.checks[index]!;
    if (
      item.checkId !== expected.checkId ||
      (item.status !== "passed" && item.status !== "failed") ||
      !Number.isInteger(item.violationCount) ||
      Number(item.violationCount) < 0 ||
      (item.status === "passed" && item.violationCount !== 0) ||
      (item.status === "failed" && item.violationCount === 0)
    ) {
      throw new Error("A semantic writing evaluation check has invalid coordinates or status.");
    }
    return {
      checkId: expected.checkId,
      status: item.status,
      violationCount: Number(item.violationCount),
    } as const;
  });
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(provider)) {
    throw new Error("The semantic writing evaluator provider is invalid.");
  }
  return {
    evaluator: { kind: "model", evaluatorId: `lervo.${provider}.semantic-writing.v1` },
    checks: normalized,
  };
}
