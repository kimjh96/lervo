import { validateSchema, type ContextQualityVerification } from "@lervo/schemas";
import { canonicalHash } from "@lervo/search";

/** Identity and state consistency are both required; a self-consistent hash is not authority. */
export function validContextOutcomeObservation(value: ContextQualityVerification): boolean {
  if (!validateSchema("contextQualityVerification", value).valid) return false;
  const { observationDigest, ...body } = value;
  if (canonicalHash(body) !== observationDigest) return false;
  if (value.protectedMaterial === "passed" && value.baselineDigest === null) return false;
  const current = value.schemaVersion === 2 ? value : null;
  const task = current?.taskVerification;
  if (current?.writingRequired === false && value.writingEvaluationDigest !== null) return false;
  if (task) {
    const { evaluationDigest, ...evidence } = task;
    const disposition = task.checks.some((check) => check.status === "failed")
      ? "failed"
      : task.checks.some((check) => check.status === "unavailable")
        ? "unavailable"
        : "passed";
    if (
      current?.scope !== "task_and_artifact" ||
      new Set(task.checks.map((check) => check.checkId)).size !== task.checks.length ||
      task.disposition !== disposition ||
      (task.evaluatorBuildId === null &&
        task.checks.some((check) => check.status !== "unavailable")) ||
      canonicalHash({
        ...evidence,
        artifactDigest: value.artifactDigest,
        planDigest: value.planDigest,
      }) !== evaluationDigest
    )
      return false;
  }
  if (
    current?.languageExceptionDigest &&
    (!current.writingRequired || !value.reasonCodes.includes("context_language_exception"))
  )
    return false;
  if (
    current &&
    value.reasonCodes.includes("context_language_exception") &&
    !current.languageExceptionDigest
  )
    return false;
  switch (value.disposition) {
    case "passed":
      return (
        (current?.writingRequired === false || value.writingEvaluationDigest !== null) &&
        value.reasonCodes.every(
          (reason) => current !== null && reason === "context_language_exception",
        ) &&
        (value.protectedMaterial === "passed" || value.protectedMaterial === "not_requested") &&
        (current?.scope !== "task_and_artifact" || task?.disposition === "passed") &&
        (!task || task.disposition === "passed") &&
        (current?.writingRequired !== false || task?.disposition === "passed")
      );
    case "failed":
      return (
        !value.reasonCodes.includes("context_binding_stale") &&
        (value.reasonCodes.includes("context_verification_failed") ||
          (value.reasonCodes.includes("context_protected_material_changed") &&
            value.protectedMaterial === "failed"))
      );
    case "unavailable":
      return value.reasonCodes.includes("context_verification_unavailable");
    case "not_applicable":
      return (
        value.reasonCodes.length === 1 &&
        value.reasonCodes[0] === "context_not_publication" &&
        value.writingEvaluationDigest === null &&
        value.protectedMaterial === "not_requested" &&
        (!current ||
          (!current.writingRequired &&
            current.taskVerification === null &&
            current.scope !== "task_and_artifact"))
      );
  }
}
