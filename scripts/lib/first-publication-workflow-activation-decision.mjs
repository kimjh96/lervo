import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const decisionIdPattern = /^wfa_[a-f0-9]{24}$/u;
const maximumLifetimeMilliseconds = 10 * 60 * 1000;

export const workflowActivationConfirmations = Object.freeze([
  "reviewed_exact_candidate_metadata_and_workflow_bytes",
  "activate_manual_tag_stage_only_job",
  "direct_publish_forbidden",
  "npm_stage_requires_separate_2fa_approval",
  "external_controls_must_remain_ready_at_apply",
]);

function fail(code = "first_publication_workflow_activation_decision_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 workflow 활성화 결정이 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function milliseconds(value) {
  const result = Date.parse(value ?? "");
  if (!Number.isFinite(result)) fail();
  return result;
}

function body(decision) {
  return {
    schemaVersion: decision.schemaVersion,
    decisionId: decision.decisionId,
    decisionType: decision.decisionType,
    actorKind: decision.actorKind,
    decision: decision.decision,
    binding: decision.binding,
    confirmations: decision.confirmations,
    decidedAt: decision.decidedAt,
    expiresAt: decision.expiresAt,
  };
}

export function createFirstPublicationWorkflowActivationDecision(input) {
  const decision = {
    schemaVersion: 1,
    decisionId: input.decisionId,
    decisionType: "first_publication_stage_only_workflow_activation",
    actorKind: "human_operator",
    decision: "approve_exact_workflow_activation",
    binding: {
      candidateDigest: input.candidateDigest,
      packageSourceSha256: input.packageSourceSha256,
      workflowSourceSha256: input.workflowSourceSha256,
      outputSha256: input.outputSha256,
    },
    confirmations: [...workflowActivationConfirmations],
    decidedAt: input.decidedAt,
    expiresAt: input.expiresAt,
  };
  validateFirstPublicationWorkflowActivationDecision({
    ...decision,
    decisionDigest: canonicalDigest(decision),
  });
  return { ...decision, decisionDigest: canonicalDigest(decision) };
}

export function validateFirstPublicationWorkflowActivationDecision(
  decision,
  { checkedAt } = {},
) {
  const value = body(decision ?? {});
  const decidedAt = milliseconds(decision?.decidedAt);
  const expiresAt = milliseconds(decision?.expiresAt);
  if (
    !exactKeys(decision, [...Object.keys(value), "decisionDigest"]) ||
    decision.schemaVersion !== 1 || !decisionIdPattern.test(decision.decisionId ?? "") ||
    decision.decisionType !== "first_publication_stage_only_workflow_activation" ||
    decision.actorKind !== "human_operator" ||
    decision.decision !== "approve_exact_workflow_activation" ||
    !exactKeys(decision.binding, [
      "candidateDigest", "packageSourceSha256", "workflowSourceSha256", "outputSha256",
    ]) || Object.values(decision.binding).some((digest) => !digestPattern.test(digest ?? "")) ||
    canonicalJson(decision.confirmations) !== canonicalJson(workflowActivationConfirmations) ||
    expiresAt <= decidedAt || expiresAt - decidedAt > maximumLifetimeMilliseconds ||
    !digestPattern.test(decision.decisionDigest ?? "") ||
    decision.decisionDigest !== canonicalDigest(value)
  ) fail();
  if (checkedAt !== undefined) {
    const checked = milliseconds(checkedAt);
    if (checked < decidedAt || checked >= expiresAt) {
      fail("first_publication_workflow_activation_decision_expired");
    }
  }
  return decision;
}
