import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

export const firstPublicationResolutionMaximumLifetimeMs = 10 * 60 * 1000;

export const firstPublicationResolutionConfirmations = Object.freeze([
  "reviewed_exact_published_reconciliation",
  "public_registry_observation_is_not_original_receipt",
  "two_factor_proof_not_recovered",
  "unknown_terminal_remains_immutable",
  "transition_requires_separate_stage_only_evidence",
]);

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const decisionIdPattern = /^res_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_resolution_decision_invalid",
    "CLI 최초 게시 결과 확정 결정이 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

export function validateFirstPublicationResolutionDecision(
  decision,
  { reconciliationReport, checkedAt },
) {
  const observedAt = timestamp(reconciliationReport?.observation?.observedAt);
  const decidedAt = timestamp(decision?.decidedAt);
  const expiresAt = timestamp(decision?.expiresAt);
  const checkedAtMs = timestamp(checkedAt);
  if (
    !exactKeys(decision, [
      "schemaVersion", "decisionId", "decision", "decidedAt", "expiresAt",
      "actor", "target", "confirmations",
    ]) || decision.schemaVersion !== 1 || !decisionIdPattern.test(decision.decisionId ?? "") ||
    decision.decision !== "authorize_reconciled_publication_transition_review" ||
    !exactKeys(decision.actor, ["kind", "id"]) || decision.actor.kind !== "user" ||
    typeof decision.actor.id !== "string" || decision.actor.id.length < 1 ||
    decision.actor.id.length > 150 ||
    !exactKeys(decision.target, [
      "package", "version", "bootstrapDigest", "reservationDigest",
      "terminalRecordDigest", "reconciliationReportDigest",
    ]) || decision.target.package !== reconciliationReport?.target?.package ||
    decision.target.version !== reconciliationReport.target.version ||
    decision.target.bootstrapDigest !== reconciliationReport.binding.bootstrapDigest ||
    decision.target.reservationDigest !== reconciliationReport.binding.reservationDigest ||
    decision.target.terminalRecordDigest !== reconciliationReport.binding.terminalRecordDigest ||
    decision.target.reconciliationReportDigest !==
      reconciliationReport.reconciliationReportDigest ||
    !digestPattern.test(decision.target.reconciliationReportDigest ?? "") ||
    canonicalJson(decision.confirmations) !==
      canonicalJson(firstPublicationResolutionConfirmations) ||
    reconciliationReport.outcome !== "published" ||
    decidedAt < observedAt || decidedAt - observedAt > firstPublicationResolutionMaximumLifetimeMs ||
    decidedAt > checkedAtMs || expiresAt <= checkedAtMs ||
    expiresAt - observedAt > firstPublicationResolutionMaximumLifetimeMs
  ) fail();
  return decision;
}
