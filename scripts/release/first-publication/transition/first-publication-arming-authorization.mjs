import {
  firstPublicationArmingMaximumLifetimeMs,
  validateFirstPublicationArmingDecision,
} from "./first-publication-arming-decision.mjs";
import {
  firstPublicationTransition,
  FirstPublicationBootstrapError,
} from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationBootstrapAuthorization } from "./first-publication-bootstrap-reader.mjs";
import {
  createFirstPublicationExecutionPlan,
  firstPublicationExecutionFreshChecks,
  validateFirstPublicationExecutionPlan,
} from "./first-publication-execution-plan.mjs";
import { canonicalDigest, canonicalJson } from "../../../shared/release-artifact-manifest.mjs";
import {
  npmPublicRegistry,
  validateReleasePublicationAuthorization,
} from "../../lib/release-publication-authorization.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const sideEffects = Object.freeze({
  reservation: "not_created",
  publication: "not_attempted",
  externalSettings: "not_changed",
});

function fail(code = "first_publication_arming_authorization_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication execution authorization is invalid.",
  );
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function timestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  )
    fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

function body(authorization) {
  return {
    schemaVersion: authorization.schemaVersion,
    status: authorization.status,
    authorizationType: authorization.authorizationType,
    target: authorization.target,
    binding: authorization.binding,
    validity: authorization.validity,
    execution: authorization.execution,
    transition: authorization.transition,
    sideEffects: authorization.sideEffects,
  };
}

function validatedPlan(bootstrap, publicationAuthorization) {
  const plan = createFirstPublicationExecutionPlan({ bootstrap, publicationAuthorization });
  validateFirstPublicationExecutionPlan(plan, { bootstrap, publicationAuthorization });
  return plan;
}

export function validateFirstPublicationArmingAuthorizationDocument(armingAuthorization) {
  const authorizationBody = body(armingAuthorization ?? {});
  const armedAt = timestamp(armingAuthorization?.validity?.armedAt);
  const validUntil = timestamp(armingAuthorization?.validity?.validUntil);
  if (
    !exactKeys(armingAuthorization, [
      ...Object.keys(authorizationBody),
      "armingAuthorizationDigest",
    ]) ||
    armingAuthorization.schemaVersion !== 1 ||
    armingAuthorization.status !== "armed" ||
    armingAuthorization.authorizationType !== "first_publication_manual_once" ||
    !exactKeys(armingAuthorization.target, [
      "registry",
      "package",
      "version",
      "distTag",
      "access",
    ]) ||
    armingAuthorization.target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(armingAuthorization.target.version ?? "") ||
    armingAuthorization.target.registry !== npmPublicRegistry ||
    !["latest", "next"].includes(armingAuthorization.target.distTag) ||
    armingAuthorization.target.access !== "public" ||
    !exactKeys(armingAuthorization.binding, [
      "bootstrapDigest",
      "publicationAuthorizationDigest",
      "executionPlanDigest",
      "decisionId",
      "decisionDigest",
    ]) ||
    !digestPattern.test(armingAuthorization.binding.bootstrapDigest ?? "") ||
    !digestPattern.test(armingAuthorization.binding.publicationAuthorizationDigest ?? "") ||
    !digestPattern.test(armingAuthorization.binding.executionPlanDigest ?? "") ||
    !/^arm_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(armingAuthorization.binding.decisionId ?? "") ||
    !digestPattern.test(armingAuthorization.binding.decisionDigest ?? "") ||
    !exactKeys(armingAuthorization.validity, ["armedAt", "validUntil"]) ||
    armedAt >= validUntil ||
    validUntil - armedAt > firstPublicationArmingMaximumLifetimeMs ||
    canonicalJson(armingAuthorization.execution) !==
      canonicalJson({
        mode: "manual_interactive_once",
        consumption: "durable_reservation",
        requiresFreshChecks: firstPublicationExecutionFreshChecks,
        publisherEntryPoint: "not_exposed",
      }) ||
    canonicalJson(armingAuthorization.transition) !== canonicalJson(firstPublicationTransition) ||
    canonicalJson(armingAuthorization.sideEffects) !== canonicalJson(sideEffects) ||
    !digestPattern.test(armingAuthorization.armingAuthorizationDigest ?? "") ||
    armingAuthorization.armingAuthorizationDigest !== canonicalDigest(authorizationBody)
  )
    fail();
  return armingAuthorization;
}

export function createFirstPublicationArmingAuthorization({
  bootstrap,
  publicationAuthorization,
  decision,
  armedAt,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  const plan = validatedPlan(bootstrap, authorization);
  const armedAtMs = timestamp(armedAt);
  if (
    armedAtMs < timestamp(bootstrap.registryObservation.observedAt) ||
    armedAtMs >= timestamp(bootstrap.registryObservation.validUntil)
  )
    fail("first_publication_arming_authorization_expired");
  validateFirstPublicationArmingDecision(decision, {
    bootstrap,
    executionPlan: plan,
    checkedAt: armedAt,
  });
  const authorizationBody = {
    schemaVersion: 1,
    status: "armed",
    authorizationType: "first_publication_manual_once",
    target: structuredClone(bootstrap.target),
    binding: {
      bootstrapDigest: bootstrap.bootstrapDigest,
      publicationAuthorizationDigest: authorization.authorizationDigest,
      executionPlanDigest: plan.executionPlanDigest,
      decisionId: decision.decisionId,
      decisionDigest: canonicalDigest(decision),
    },
    validity: {
      armedAt,
      validUntil: decision.expiresAt,
    },
    execution: {
      mode: "manual_interactive_once",
      consumption: "durable_reservation",
      requiresFreshChecks: structuredClone(plan.preflight.requiredAtExecution),
      publisherEntryPoint: "not_exposed",
    },
    transition: structuredClone(bootstrap.transition),
    sideEffects: structuredClone(sideEffects),
  };
  return {
    ...authorizationBody,
    armingAuthorizationDigest: canonicalDigest(authorizationBody),
  };
}

export function validateFirstPublicationArmingAuthorization(
  armingAuthorization,
  { bootstrap, publicationAuthorization, checkedAt },
) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  validateFirstPublicationArmingAuthorizationDocument(armingAuthorization);
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  const plan = validatedPlan(bootstrap, authorization);
  const armedAt = timestamp(armingAuthorization?.validity?.armedAt);
  const validUntil = timestamp(armingAuthorization?.validity?.validUntil);
  const checkedAtMs = timestamp(checkedAt);
  if (
    canonicalJson(armingAuthorization.target) !== canonicalJson(bootstrap.target) ||
    armingAuthorization.binding.bootstrapDigest !== bootstrap.bootstrapDigest ||
    armingAuthorization.binding.publicationAuthorizationDigest !==
      authorization.authorizationDigest ||
    armingAuthorization.binding.executionPlanDigest !== plan.executionPlanDigest ||
    armedAt < timestamp(bootstrap.registryObservation.observedAt) ||
    armedAt > checkedAtMs ||
    checkedAtMs >= validUntil ||
    validUntil > timestamp(bootstrap.registryObservation.validUntil) ||
    canonicalJson(armingAuthorization.execution.requiresFreshChecks) !==
      canonicalJson(plan.preflight.requiredAtExecution) ||
    canonicalJson(armingAuthorization.transition) !== canonicalJson(bootstrap.transition)
  )
    fail();
  return armingAuthorization;
}
