import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";

const digest = (value: unknown) =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const hash = /^sha256:[a-f0-9]{64}$/u;
export interface ArtifactTaskDefinition {
  definitionId: string;
  taskDigest: string;
  checks: { checkId: string; requirement: string }[];
}
export interface ArtifactTaskRequest {
  artifactDigest: string;
  planDigest: string;
  definitionHash: string;
  definition: ArtifactTaskDefinition;
  content: string;
}
export interface ArtifactTaskEvaluator {
  buildId: string;
  evaluate(request: ArtifactTaskRequest): Promise<{
    artifactDigest: string;
    planDigest: string;
    definitionHash: string;
    checks: { checkId: string; status: "passed" | "failed" | "unavailable" }[];
  }>;
}
export interface ArtifactTaskEvaluation {
  definitionHash: string;
  evaluatorBuildId: string | null;
  disposition: "passed" | "failed" | "unavailable";
  checks: { checkId: string; status: "passed" | "failed" | "unavailable" }[];
  evaluationDigest: string;
}
export function validateArtifactTaskDefinition(value: ArtifactTaskDefinition): void {
  if (
    !value ||
    !identifier.test(value.definitionId) ||
    !hash.test(value.taskDigest) ||
    Object.keys(value).some((key) => !["definitionId", "taskDigest", "checks"].includes(key)) ||
    !Array.isArray(value.checks) ||
    !value.checks.length ||
    value.checks.length > 64 ||
    new Set(value.checks.map((check) => check.checkId)).size !== value.checks.length ||
    Buffer.byteLength(JSON.stringify(value), "utf8") > 16384 ||
    value.checks.some(
      (check) =>
        !identifier.test(check.checkId) ||
        typeof check.requirement !== "string" ||
        !check.requirement.trim() ||
        Object.keys(check).some((key) => !["checkId", "requirement"].includes(key)),
    )
  ) {
    throw new TypeError("Invalid artifact task definition.");
  }
}

/** The caller owns evaluator admission. No process, provider, or command is started implicitly. */
export async function evaluateArtifactTask(input: {
  definition: ArtifactTaskDefinition;
  artifactDigest: string;
  planDigest: string;
  content: string;
  evaluator?: ArtifactTaskEvaluator;
}): Promise<ArtifactTaskEvaluation> {
  const definition = structuredClone(input.definition);
  validateArtifactTaskDefinition(definition);
  if (
    !hash.test(input.artifactDigest) ||
    !hash.test(input.planDigest) ||
    Buffer.byteLength(input.content, "utf8") > 1048576 ||
    `sha256:${createHash("sha256").update(input.content).digest("hex")}` !== input.artifactDigest
  )
    throw new TypeError("Invalid artifact task coordinates.");
  const definitionHash = digest(definition);
  const request = {
    definition,
    definitionHash,
    artifactDigest: input.artifactDigest,
    planDigest: input.planDigest,
    content: input.content,
  };
  const buildId = input.evaluator?.buildId;
  let checks: ArtifactTaskEvaluation["checks"] = definition.checks.map(({ checkId }) => ({
    checkId,
    status: "unavailable",
  }));
  let evaluatorBuildId: string | null = null;
  if (input.evaluator && buildId && hash.test(buildId)) {
    try {
      const response = await input.evaluator.evaluate(structuredClone(request));
      if (
        response.artifactDigest === request.artifactDigest &&
        response.planDigest === request.planDigest &&
        response.definitionHash === definitionHash &&
        Array.isArray(response.checks) &&
        response.checks.length === checks.length &&
        new Set(response.checks.map((check) => check.checkId)).size === checks.length &&
        response.checks.every(
          (check) =>
            checks.some((required) => required.checkId === check.checkId) &&
            ["passed", "failed", "unavailable"].includes(check.status) &&
            Object.keys(check).every((key) => ["checkId", "status"].includes(key)),
        ) &&
        Object.keys(response).every((key) =>
          ["artifactDigest", "planDigest", "definitionHash", "checks"].includes(key),
        )
      ) {
        checks = definition.checks.map(({ checkId }) => ({
          ...response.checks.find((check) => check.checkId === checkId)!,
        }));
        evaluatorBuildId = buildId;
      }
    } catch {
      // Evaluator failures retain no private error or artifact text.
    }
  }
  const disposition = checks.some((check) => check.status === "failed")
    ? "failed"
    : checks.some((check) => check.status === "unavailable")
      ? "unavailable"
      : "passed";
  const body = { definitionHash, evaluatorBuildId, disposition, checks };
  return {
    ...body,
    disposition,
    evaluationDigest: digest({
      ...body,
      artifactDigest: input.artifactDigest,
      planDigest: input.planDigest,
    }),
  };
}
