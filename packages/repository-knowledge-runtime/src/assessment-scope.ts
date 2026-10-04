import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

/** Sensitive sources stay local, explicit policy exclusions stay visible, and opaque assets retain obligations. */
export function convergenceAssessmentSources(state: KnowledgeConvergenceInput) {
  const sources = (state.stageData.assessmentSources ??
    state.baseline.sources) as typeof state.baseline.sources;
  const dispositions = new Map(state.baseline.sourceDispositions?.map((item) => [item.path, item]));
  const obligations =
    state.baseline.assessmentPaths === undefined ? null : new Set(state.baseline.assessmentPaths);
  return sources.filter(
    (source) =>
      source.kind === "text" &&
      (obligations === null || obligations.has(source.path)) &&
      !["sensitive_local", "policy_excluded"].includes(
        dispositions.get(source.path)?.kind ?? "semantic_source",
      ),
  );
}
