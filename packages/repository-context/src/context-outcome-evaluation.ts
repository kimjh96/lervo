import { ContextQualityError, protectedMarkdownDigests } from "@lervo/context";
import { canonicalHash } from "@lervo/search";
import { sha256 } from "@lervo/repository-knowledge";
import { createWritingEvaluation, resolveArtifactWritingContract } from "@lervo/writing";
import { evaluateArtifactTask, validateArtifactTaskDefinition } from "@lervo/verification";
import type { ContextQualityVerification } from "@lervo/schemas";
import { validContextOutcomeObservation } from "./context-outcome-observation.js";
import { contextOutcomeEvaluatorBuild, type ContextOutcomeInput } from "./context-outcome-types.js";

type Observation = Extract<ContextQualityVerification, { schemaVersion: 2 }>;
export async function evaluateContextOutcomeBytes(
  input: ContextOutcomeInput,
  source: Uint8Array,
  assertArtifactCurrent: () => Promise<void>,
): Promise<Observation> {
  const bytes = new Uint8Array(source);
  const definition = input.definition;
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(input.planDigest) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(definition.definitionId) ||
    typeof definition.language !== "string" ||
    typeof definition.preserveProtectedMaterial !== "boolean" ||
    Object.keys(definition).some(
      (key) =>
        ![
          "definitionId",
          "language",
          "preserveProtectedMaterial",
          "task",
          "languageException",
        ].includes(key),
    ) ||
    bytes.byteLength > 1048576 ||
    (input.baselineBytes?.byteLength ?? 0) > 1048576
  )
    throw new TypeError("Outcome verification coordinates are invalid.");
  if (definition.task) validateArtifactTaskDefinition(definition.task);
  const artifactDigest = sha256(bytes);
  const reasons: Observation["reasonCodes"] = [];
  let disposition: Observation["disposition"];
  let protectedMaterial: Observation["protectedMaterial"] = "not_requested";
  let writingEvaluationDigest: string | null = null;
  let languageExceptionDigest: string | null = null;
  let taskVerification: Observation["taskVerification"] = null;
  try {
    await input.assertPlanCurrent();
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!input.isPublication && !definition.task) {
      disposition = "not_applicable";
      reasons.push("context_not_publication");
    } else {
      if (definition.preserveProtectedMaterial) {
        protectedMaterial =
          input.baselineBytes === undefined
            ? "unavailable"
            : canonicalHash(protectedMarkdownDigests(input.baselineBytes)) ===
                canonicalHash(protectedMarkdownDigests(bytes))
              ? "passed"
              : "failed";
      }
      if (definition.task)
        taskVerification = await evaluateArtifactTask({
          definition: definition.task,
          artifactDigest,
          planDigest: input.planDigest,
          content,
          ...(input.taskEvaluator ? { evaluator: input.taskEvaluator } : {}),
        });
      let writing: "passed" | "failed" | "unavailable" = "passed";
      if (input.isPublication) {
        try {
          const contract = await resolveArtifactWritingContract({
            language: definition.language,
            planDigest: input.planDigest,
            artifactPath: input.artifactPath,
            definitionId: definition.definitionId,
            ...(definition.languageException ? { exception: definition.languageException } : {}),
            ...(input.authorizeLanguageException
              ? { authorizeException: input.authorizeLanguageException }
              : {}),
          });
          if (definition.languageException)
            languageExceptionDigest = canonicalHash(definition.languageException);
          const result = await createWritingEvaluation({
            content,
            artifact: {
              artifactId: `art_${artifactDigest.slice(7)}`,
              contentHash: artifactDigest,
              uri: `urn:sha256:${artifactDigest.slice(7)}`,
              mediaType: "text/markdown; charset=utf-8",
              byteCount: bytes.byteLength,
            },
            contract,
            surface: "documentation",
            checkedAt: (input.now?.() ?? new Date()).toISOString(),
            ...(input.evaluator ? { evaluator: input.evaluator } : {}),
          });
          writingEvaluationDigest = canonicalHash(result.evaluation);
          writing = result.evaluation.checks.some((check) => check.status === "failed")
            ? "failed"
            : result.evaluation.overallStatus === "incomplete"
              ? "unavailable"
              : result.evaluation.overallStatus;
        } catch {
          // Missing policy/exception/evaluator evidence cannot erase an independent known failure.
          writing = "unavailable";
        }
      }
      if (protectedMaterial === "failed") reasons.push("context_protected_material_changed");
      if (writing === "failed" || taskVerification?.disposition === "failed")
        reasons.push("context_verification_failed");
      disposition = reasons.length
        ? "failed"
        : writing === "unavailable" ||
            taskVerification?.disposition === "unavailable" ||
            protectedMaterial === "unavailable"
          ? "unavailable"
          : "passed";
      if (disposition === "unavailable") reasons.push("context_verification_unavailable");
      if (languageExceptionDigest) reasons.push("context_language_exception");
    }
    await input.assertPlanCurrent();
    if (
      languageExceptionDigest &&
      (!input.authorizeLanguageException ||
        !(await input.authorizeLanguageException(structuredClone(definition.languageException!))))
    )
      throw new ContextQualityError("context_binding_stale");
    await assertArtifactCurrent();
  } catch (error) {
    if (error instanceof ContextQualityError && error.code === "context_binding_stale")
      reasons.push("context_binding_stale");
    disposition = "unavailable";
    reasons.push("context_verification_unavailable");
  }
  const body = {
    schemaVersion: 2 as const,
    planDigest: input.planDigest,
    artifactDigest,
    baselineDigest: input.baselineBytes === undefined ? null : sha256(input.baselineBytes),
    verificationDefinitionId: definition.definitionId,
    verificationDefinitionHash: canonicalHash(definition),
    evaluatorBuildId: contextOutcomeEvaluatorBuild,
    scope: definition.task
      ? ("task_and_artifact" as const)
      : ("publication_writing_and_protected_material" as const),
    writingRequired: input.isPublication,
    taskVerification,
    languageExceptionDigest,
    disposition,
    reasonCodes: [...new Set(reasons)].sort(),
    writingEvaluationDigest,
    protectedMaterial,
    observedAt: (input.now?.() ?? new Date()).toISOString(),
  };
  const result = { ...body, observationDigest: canonicalHash(body) };
  if (!validContextOutcomeObservation(result)) throw new TypeError("Invalid outcome observation.");
  return result;
}
