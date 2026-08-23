import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { firstPublicationOperatorConfirmations } from
  "./first-publication-operator-confirmations.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReleasePublicationAuthorization } from
  "./release-publication-authorization.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const sideEffects = {
  reservation: "not_created",
  publication: "not_attempted",
  externalSettings: "not_changed",
};

export const firstPublicationExecutionFreshChecks = Object.freeze([
  "bootstrap_freshness",
  "interactive_npm_readiness",
  "public_package_absence",
  "reservation_availability",
  "release_artifact_integrity",
]);

export const firstPublicationExecutionSteps = Object.freeze([
  {
    sequence: 1,
    id: "validate_execution_inputs",
    effect: "read_only",
    cancellation: "safe_without_state_change",
  },
  {
    sequence: 2,
    id: "prepare_interactive_publisher",
    effect: "temporary_local",
    cancellation: "safe_without_state_change",
  },
  {
    sequence: 3,
    id: "reobserve_public_package_absence",
    effect: "external_read",
    cancellation: "safe_without_state_change",
  },
  {
    sequence: 4,
    id: "create_durable_reservation",
    effect: "local_durable",
    cancellation: "abort_and_new_bootstrap_required",
  },
  {
    sequence: 5,
    id: "revalidate_release_artifact",
    effect: "read_only_after_reservation",
    cancellation: "abort_and_new_bootstrap_required",
  },
  {
    sequence: 6,
    id: "attempt_publication",
    effect: "external_irreversible",
    cancellation: "reconciliation_required_retry_forbidden",
  },
  {
    sequence: 7,
    id: "verify_registry_result",
    effect: "external_read_after_write",
    cancellation: "reconciliation_required_retry_forbidden",
  },
  {
    sequence: 8,
    id: "record_terminal_result",
    effect: "local_durable_after_write",
    cancellation: "reconciliation_required_retry_forbidden",
  },
].map(Object.freeze));

export const firstPublicationCancellationBoundaries = Object.freeze([
  {
    boundary: "before_reservation",
    outcome: "no_state_change",
    retry: "same_bootstrap_requires_fresh_preflight",
  },
  {
    boundary: "after_reservation_before_publication",
    outcome: "aborted_before_publication",
    retry: "new_bootstrap_required",
  },
  {
    boundary: "after_publication_started",
    outcome: "publication_unknown_until_reconciled",
    retry: "forbidden",
  },
].map(Object.freeze));

function fail(code = "first_publication_execution_plan_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication execution plan is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function body(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    status: plan.status,
    activation: plan.activation,
    bootstrapDigest: plan.bootstrapDigest,
    publicationAuthorizationDigest: plan.publicationAuthorizationDigest,
    target: plan.target,
    artifactSha256: plan.artifactSha256,
    preflight: plan.preflight,
    confirmations: plan.confirmations,
    steps: plan.steps,
    cancellationBoundaries: plan.cancellationBoundaries,
    sideEffects: plan.sideEffects,
  };
}

export function createFirstPublicationExecutionPlan({
  bootstrap,
  publicationAuthorization,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  if (
    authorization.authorizationDigest !== bootstrap.release.publicationAuthorizationDigest ||
    canonicalJson(authorization.target) !== canonicalJson(bootstrap.target) ||
    canonicalJson(authorization.artifact) !== canonicalJson(bootstrap.release.artifact)
  ) fail("first_publication_execution_plan_authorization_mismatch");
  const planBody = {
    schemaVersion: 1,
    status: "not_armed",
    activation: "not_implemented",
    bootstrapDigest: bootstrap.bootstrapDigest,
    publicationAuthorizationDigest: authorization.authorizationDigest,
    target: structuredClone(bootstrap.target),
    artifactSha256: bootstrap.release.artifact.sha256,
    preflight: {
      priorReportIsPermit: false,
      requiredAtExecution: [...firstPublicationExecutionFreshChecks],
    },
    confirmations: firstPublicationOperatorConfirmations(bootstrap),
    steps: structuredClone(firstPublicationExecutionSteps),
    cancellationBoundaries: structuredClone(firstPublicationCancellationBoundaries),
    sideEffects: structuredClone(sideEffects),
  };
  return { ...planBody, executionPlanDigest: canonicalDigest(planBody) };
}

export function validateFirstPublicationExecutionPlan(
  plan,
  { bootstrap, publicationAuthorization },
) {
  const planBody = body(plan ?? {});
  if (
    !exactKeys(plan, [...Object.keys(planBody), "executionPlanDigest"]) ||
    plan.schemaVersion !== 1 || plan.status !== "not_armed" ||
    plan.activation !== "not_implemented" ||
    !digestPattern.test(plan.bootstrapDigest ?? "") ||
    !digestPattern.test(plan.publicationAuthorizationDigest ?? "") ||
    !/^[a-f0-9]{64}$/u.test(plan.artifactSha256 ?? "") ||
    canonicalJson(plan.sideEffects) !== canonicalJson(sideEffects) ||
    plan.executionPlanDigest !== canonicalDigest(planBody)
  ) fail();
  let expected;
  try {
    expected = createFirstPublicationExecutionPlan({ bootstrap, publicationAuthorization });
  } catch {
    fail();
  }
  if (canonicalJson(expected) !== canonicalJson(plan)) fail();
  return plan;
}
