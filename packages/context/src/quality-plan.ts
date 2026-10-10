import { canonicalHash } from "@lervo/search";
import {
  validateSchema,
  type ContextQualityEvidence,
  type ContextQualityPlan,
  type ContextQualityRequest,
  type ContextQualityReasonCode,
} from "@lervo/schemas";

import { ContextQualityError, validateContextQualityRequest } from "./quality-request.js";
import { validateQualitySections, type ContextQualitySourceBytes } from "./quality-sections.js";

function validateCorpus(request: ContextQualityRequest, evidence: ContextQualityEvidence): void {
  const corpus = evidence.corpusCoverage;
  if (
    corpus.scopeDigest !== request.scopeDigest ||
    corpus.sourceSnapshotId !== request.sourceSnapshotId
  )
    throw new ContextQualityError("context_binding_stale");
  if (
    corpus.disposition === "complete" &&
    (corpus.discovered === null ||
      corpus.eligible === null ||
      corpus.indexed === null ||
      corpus.excluded === null ||
      corpus.unavailable !== 0 ||
      corpus.discovered !== corpus.eligible + corpus.excluded ||
      corpus.indexed !== corpus.eligible)
  )
    throw new ContextQualityError("context_contract_invalid");
  if (
    (evidence.retrieval.disposition === "completed") !==
    (evidence.retrieval.resultDigest !== null)
  )
    throw new ContextQualityError("context_contract_invalid");
}

function planDigest(
  plan: Omit<ContextQualityPlan, "planDigest"> & { planDigest?: string },
): string {
  const {
    planDigest: _digest,
    requestId: _requestId,
    retrievalReceiptRefs: _receipts,
    costObservation: _cost,
    ...semantic
  } = plan;
  return canonicalHash(semantic);
}

/** Only explicitly complete owner observations can establish a ready or no-evidence plan. */
export function createContextQualityPlan(input: {
  request: ContextQualityRequest;
  evidence: ContextQualityEvidence;
  sources: readonly ContextQualitySourceBytes[];
}): ContextQualityPlan {
  validateContextQualityRequest(input.request);
  if (!validateSchema("contextQualityEvidence", input.evidence).valid)
    throw new ContextQualityError("context_contract_invalid");
  const request = input.request;
  const evidence = structuredClone(input.evidence);
  evidence.obligations.sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
  for (const rule of evidence.obligations) {
    rule.conditionRefs.sort();
    rule.exceptionRefs.sort();
  }
  for (const section of evidence.sections) section.ruleIds.sort();
  validateCorpus(request, evidence);
  const coverage = validateQualitySections(request, evidence, input.sources);
  const reasons = new Set<ContextQualityReasonCode>();
  if (
    evidence.applicability !== "complete" ||
    evidence.obligations.some((r) => r.disposition === "unresolved")
  )
    reasons.add("context_rule_unresolved");
  if (evidence.obligations.some((r) => r.disposition === "conflict"))
    reasons.add("context_rule_conflict");
  if (evidence.corpusCoverage.disposition !== "complete") reasons.add("context_corpus_incomplete");
  if (evidence.retrieval.disposition !== "completed") reasons.add("context_retrieval_unavailable");
  if (coverage.missingRuleIds.length > 0) reasons.add("context_required_section_missing");
  if (evidence.tokenCount === null) reasons.add("context_token_count_unavailable");
  if (
    coverage.preparedByteCount > request.profile.maximumBytes ||
    (evidence.tokenCount !== null && evidence.tokenCount > request.profile.maximumTokens)
  )
    reasons.add("context_capacity_insufficient");
  const status = reasons.has("context_retrieval_unavailable")
    ? "unavailable"
    : reasons.size > 0
      ? "incomplete"
      : coverage.packedEvidenceCount === 0 && evidence.selectedEvidenceCount === 0
        ? "no_evidence"
        : "ready";
  if (status === "ready" && coverage.packedEvidenceCount === 0)
    reasons.add("context_capacity_insufficient");
  const plan: Omit<ContextQualityPlan, "planDigest"> = {
    schemaVersion: 1,
    requestId: request.requestId,
    semanticInputDigest: request.semanticInputDigest,
    status: reasons.size > 0 && status === "ready" ? "incomplete" : status,
    reasonCodes: [...reasons].sort(),
    ...evidence,
    coverage,
    costObservation: { elapsedMs: null, reason: "unobserved" },
  };
  const result = { ...plan, planDigest: planDigest(plan) };
  if (!validateSchema("contextQualityPlan", result).valid)
    throw new ContextQualityError("context_contract_invalid");
  return result;
}

/** Recompute against exact current inputs and source bytes; a self-supplied hash is insufficient. */
export function validateContextQualityPlan(
  plan: unknown,
  request: ContextQualityRequest,
  sources: readonly ContextQualitySourceBytes[],
): asserts plan is ContextQualityPlan {
  if (!validateSchema("contextQualityPlan", plan).valid)
    throw new ContextQualityError("context_contract_invalid");
  const value = plan as ContextQualityPlan;
  if ((value.costObservation.reason === "observed") !== (value.costObservation.elapsedMs !== null))
    throw new ContextQualityError("context_contract_invalid");
  const evidence: ContextQualityEvidence = {
    applicability: value.applicability,
    obligations: value.obligations,
    corpusCoverage: value.corpusCoverage,
    retrieval: value.retrieval,
    sections: value.sections,
    selectedEvidenceCount: value.selectedEvidenceCount,
    tokenCount: value.tokenCount,
    retrievalReceiptRefs: value.retrievalReceiptRefs,
  };
  const expected = createContextQualityPlan({ request, evidence, sources });
  if (
    value.requestId !== request.requestId ||
    value.semanticInputDigest !== request.semanticInputDigest ||
    value.planDigest !== expected.planDigest ||
    planDigest(value) !== expected.planDigest
  )
    throw new ContextQualityError("context_binding_stale");
}
