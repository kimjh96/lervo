import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const decisionIdPattern = /^nsa_[a-f0-9]{24}$/u;
const maximumLifetimeMilliseconds = 10 * 60 * 1000;

export const stageApprovalConfirmations = Object.freeze([
  "reviewed_exact_staged_package_and_tarball",
  "approve_makes_package_public",
  "interactive_2fa_required",
  "stage_reject_forbidden",
  "approval_outcome_must_be_verified_separately",
]);

function fail(code = "first_publication_stage_approval_decision_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI npm stage 승인 결정이 올바르지 않습니다.",
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

export function createFirstPublicationStageApprovalDecision(input) {
  const value = {
    schemaVersion: 1,
    decisionId: input.decisionId,
    decisionType: "first_publication_npm_stage_approval",
    actorKind: "human_operator",
    decision: "approve_exact_staged_package",
    binding: {
      stageReviewEvidenceDigest: input.stageReviewEvidenceDigest,
      stageIdDigest: input.stageIdDigest,
      package: input.package,
      version: input.version,
    },
    confirmations: [...stageApprovalConfirmations],
    decidedAt: input.decidedAt,
    expiresAt: input.expiresAt,
  };
  const decision = { ...value, decisionDigest: canonicalDigest(value) };
  return validateFirstPublicationStageApprovalDecision(decision);
}

export function validateFirstPublicationStageApprovalDecision(
  decision,
  { checkedAt } = {},
) {
  const value = body(decision ?? {});
  const decidedAt = milliseconds(decision?.decidedAt);
  const expiresAt = milliseconds(decision?.expiresAt);
  if (
    !exactKeys(decision, [...Object.keys(value), "decisionDigest"]) ||
    decision.schemaVersion !== 1 || !decisionIdPattern.test(decision.decisionId ?? "") ||
    decision.decisionType !== "first_publication_npm_stage_approval" ||
    decision.actorKind !== "human_operator" ||
    decision.decision !== "approve_exact_staged_package" ||
    !exactKeys(decision.binding, [
      "stageReviewEvidenceDigest", "stageIdDigest", "package", "version",
    ]) || !digestPattern.test(decision.binding.stageReviewEvidenceDigest ?? "") ||
    !digestPattern.test(decision.binding.stageIdDigest ?? "") ||
    decision.binding.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(decision.binding.version ?? "") ||
    canonicalJson(decision.confirmations) !== canonicalJson(stageApprovalConfirmations) ||
    expiresAt <= decidedAt || expiresAt - decidedAt > maximumLifetimeMilliseconds ||
    !digestPattern.test(decision.decisionDigest ?? "") ||
    decision.decisionDigest !== canonicalDigest(value)
  ) fail();
  if (checkedAt !== undefined) {
    const checked = milliseconds(checkedAt);
    if (checked < decidedAt || checked >= expiresAt) {
      fail("first_publication_stage_approval_decision_expired");
    }
  }
  return decision;
}
