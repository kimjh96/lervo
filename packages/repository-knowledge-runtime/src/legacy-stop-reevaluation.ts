import { KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT } from "@lervo/repository-knowledge";

/**
 * Runtimes before ADR-0479 stopped the whole obligation on a semantic rejection, an unverified
 * opaque asset, or a lifecycle review that disclosed every repository source. None of these
 * dependency shapes is produced any more, so each is reevaluated exactly once by its stage under
 * parking, suite-bound asset settlement, and plan-scoped review. A source-limit failure recorded by
 * this runtime carries `evaluationContract`, so a repeated limit stays settled instead of looping;
 * one recorded under an earlier contract, such as ADR-0479 before ADR-0480 stopped disclosing
 * generated projection bytes, is reevaluated once.
 */
export function legacyWholePipelineStop(dependency: {
  kind?: string;
  code?: string;
  evaluationContract?: string;
}): boolean {
  if (
    dependency.kind === "normalization_rejection" ||
    dependency.kind === "canonical_rejection" ||
    dependency.kind === "typed_asset_verification"
  )
    return true;
  return (
    dependency.kind === "stage_failure" &&
    dependency.code === "knowledge_source_limit_exceeded" &&
    dependency.evaluationContract !== KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT
  );
}
