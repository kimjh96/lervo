import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationWorkflowActivationDecision } from "./first-publication-workflow-activation-decision.mjs";
import { validateFirstPublicationWorkflowActivationCandidate } from "./first-publication-workflow-activation-candidate.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";
import {
  createTrustedPublisherReadinessReport,
  trustedPublisherEnvironment,
  trustedPublisherWorkflow,
  validateReadinessRepository,
} from "./trusted-publisher-readiness.mjs";

const maximumReadinessLifetimeMilliseconds = 5 * 60 * 1000;

function fail(code = "first_publication_workflow_activation_permit_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication workflow activation authorization is invalid.",
  );
}

function milliseconds(value) {
  const result = Date.parse(value ?? "");
  if (!Number.isFinite(result)) fail();
  return result;
}

function readyReport({ repository, packageManifest, workflow }) {
  return createTrustedPublisherReadinessReport({
    repository,
    packageManifest,
    workflow,
    npmObservation: {
      schemaVersion: 1,
      source: "npm_trust",
      state: "configured",
      package: "@lervo/cli",
      provider: "github",
      repository,
      workflow: trustedPublisherWorkflow,
      environment: trustedPublisherEnvironment,
      permissions: ["createStagedPackage"],
    },
    githubObservation: {
      schemaVersion: 1,
      source: "github_environment",
      state: "observed",
      repository,
      environment: trustedPublisherEnvironment,
      requiredReviewerCount: 1,
      preventSelfReview: true,
      tagPolicies: ["v*"],
    },
  });
}

export function validateReadyWorkflowActivationReadiness(
  report,
  { repository, packageManifest, workflow },
) {
  validateReadinessRepository(repository);
  const expected = readyReport({ repository, packageManifest, workflow });
  if (
    expected.status !== "ready" ||
    report?.status !== "ready" ||
    canonicalJson(report) !== canonicalJson(expected)
  )
    fail("first_publication_workflow_activation_controls_not_ready");
  return report;
}

function permitBody(input) {
  const {
    candidateResult,
    candidateInput,
    decision,
    readinessReport,
    repository,
    packageManifest,
    workflow,
    observedAt,
  } = input;
  validateReadinessRepository(repository);
  validateFirstPublicationWorkflowActivationCandidate(candidateResult, candidateInput);
  validateFirstPublicationWorkflowActivationDecision(decision, { checkedAt: observedAt });
  validateReadyWorkflowActivationReadiness(readinessReport, {
    repository,
    packageManifest,
    workflow,
  });
  const candidate = candidateResult.candidate;
  if (
    decision.binding.candidateDigest !== candidate.candidateDigest ||
    decision.binding.packageSourceSha256 !== candidate.sources.package.sha256 ||
    decision.binding.workflowSourceSha256 !== candidate.sources.workflow.sha256 ||
    decision.binding.outputSha256 !== candidate.output.sha256
  )
    fail("first_publication_workflow_activation_review_mismatch");
  const observed = milliseconds(observedAt);
  const expiresAt = new Date(
    Math.min(observed + maximumReadinessLifetimeMilliseconds, milliseconds(decision.expiresAt)),
  ).toISOString();
  return {
    schemaVersion: 1,
    status: "apply_permitted",
    permitType: "first_publication_stage_only_workflow_activation",
    target: {
      registry: npmPublicRegistry,
      package: "@lervo/cli",
      repository,
      workflow: trustedPublisherWorkflow,
      environment: trustedPublisherEnvironment,
    },
    binding: {
      candidateDigest: candidate.candidateDigest,
      packageSource: structuredClone(candidate.sources.package),
      workflowSource: structuredClone(candidate.sources.workflow),
      output: structuredClone(candidate.output),
    },
    decision: {
      decisionId: decision.decisionId,
      decisionDigest: decision.decisionDigest,
      actorKind: "human_operator",
    },
    readiness: {
      observedAt,
      expiresAt,
      report: structuredClone(readinessReport),
    },
    authority: {
      workflow: "replace_if_all_sources_match",
      change: "insert_exact_publish_cli_job_only",
      externalSettings: "observe_only",
      publication: "not_authorized",
    },
    replayProtection: "source_compare_and_swap_and_expiry",
    sideEffects: {
      workflow: "not_changed",
      npmSettings: "not_changed",
      githubSettings: "not_changed",
      publication: "not_attempted",
    },
  };
}

export function createFirstPublicationWorkflowActivationPermit(input) {
  const body = permitBody(input);
  return { ...body, permitDigest: canonicalDigest(body) };
}

export function validateFirstPublicationWorkflowActivationPermit(
  permit,
  input,
  { checkedAt } = {},
) {
  let expected;
  try {
    expected = createFirstPublicationWorkflowActivationPermit(input);
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
  if (canonicalJson(permit) !== canonicalJson(expected)) fail();
  if (checkedAt !== undefined) {
    const checked = milliseconds(checkedAt);
    if (
      checked < milliseconds(permit.readiness.observedAt) ||
      checked >= milliseconds(permit.readiness.expiresAt)
    )
      fail("first_publication_workflow_activation_permit_expired");
  }
  return permit;
}
