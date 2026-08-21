import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

export const firstPublicationArmingMaximumLifetimeMs = 5 * 60 * 1000;

export const firstPublicationArmingConfirmations = Object.freeze([
  "reviewed_exact_execution_plan",
  "preflight_is_not_execution_permission",
  "fresh_checks_required_at_execution",
  "one_time_manual_2fa_publication_authorized",
  "unknown_outcome_requires_reconciliation",
]);

const decisionIdPattern = /^arm_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function fail(code = "first_publication_arming_decision_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "CLI 최초 게시 실행 승인 결정이 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

export function validateFirstPublicationArmingDecision(
  decision,
  { bootstrap, executionPlan, checkedAt },
) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const decidedAt = timestamp(decision?.decidedAt);
  const expiresAt = timestamp(decision?.expiresAt);
  const checkedAtMs = timestamp(checkedAt);
  if (
    !exactKeys(decision, [
      "schemaVersion", "decisionId", "decision", "decidedAt", "expiresAt",
      "actor", "target", "confirmations",
    ]) || decision.schemaVersion !== 1 ||
    !decisionIdPattern.test(decision.decisionId ?? "") ||
    decision.decision !== "authorize_first_publication_once" ||
    !exactKeys(decision.actor, ["kind", "id"]) || decision.actor.kind !== "user" ||
    typeof decision.actor.id !== "string" || decision.actor.id.length < 1 ||
    decision.actor.id.length > 150 ||
    !exactKeys(decision.target, [
      "package", "version", "bootstrapDigest", "publicationAuthorizationDigest",
      "executionPlanDigest",
    ]) || decision.target.package !== bootstrap.target.package ||
    decision.target.version !== bootstrap.target.version ||
    decision.target.bootstrapDigest !== bootstrap.bootstrapDigest ||
    decision.target.publicationAuthorizationDigest !==
      bootstrap.release.publicationAuthorizationDigest ||
    decision.target.executionPlanDigest !== executionPlan?.executionPlanDigest ||
    !digestPattern.test(decision.target.executionPlanDigest ?? "") ||
    canonicalJson(decision.confirmations) !==
      canonicalJson(firstPublicationArmingConfirmations) ||
    decidedAt < timestamp(bootstrap.registryObservation.observedAt) ||
    decidedAt > checkedAtMs || expiresAt <= checkedAtMs ||
    expiresAt > timestamp(bootstrap.registryObservation.validUntil) ||
    expiresAt - decidedAt > firstPublicationArmingMaximumLifetimeMs
  ) fail();
  return decision;
}
