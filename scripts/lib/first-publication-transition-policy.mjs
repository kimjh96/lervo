import { canonicalDigest } from "./release-artifact-manifest.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { inspectFirstPublicationPublicRelease } from
  "./first-publication-public-release-policy.mjs";
import { resolveFirstPublicationTransitionEvidence } from
  "./first-publication-transition-evidence.mjs";
import {
  inspectFirstPublicationGitHubStageEnvironment,
  inspectFirstPublicationNpmStageTrust,
  inspectFirstPublicationStageOnlyWorkflow,
} from "./first-publication-stage-only-policy.mjs";

export {
  inspectFirstPublicationGitHubStageEnvironment,
  inspectFirstPublicationNpmStageTrust,
  inspectFirstPublicationStageOnlyWorkflow,
  stageOnlyPublicationCommand,
  stageOnlyRunCommands,
  stageOnlyWorkflowSteps,
  stageResultUploadStep,
} from "./first-publication-stage-only-policy.mjs";

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_transition_input_invalid",
    "CLI 최초 게시 전환 입력이 올바르지 않습니다.",
  );
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  return milliseconds;
}

function check(id, reasons) {
  return { id, status: reasons.length === 0 ? "ready" : "blocked", reasons };
}

export function createFirstPublicationTransitionReport({
  bootstrap,
  armingAuthorization,
  publicationAuthorization,
  publicationEvidence,
  publicReleaseObservation,
  workflow,
  npmObservation,
  githubObservation,
  observedAt,
}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  const evidence = resolveFirstPublicationTransitionEvidence(publicationEvidence, {
    bootstrap,
    armingAuthorization,
    publicationAuthorization,
  });
  if (workflow === null || typeof workflow !== "object" || Array.isArray(workflow)) fail();
  if (timestamp(observedAt) < timestamp(evidence.evidenceAt)) fail();
  const publicRelease = inspectFirstPublicationPublicRelease({
    observation: publicReleaseObservation,
    target: bootstrap.target,
    artifact: bootstrap.release.artifact,
  });
  const publicReleaseReasons = [...new Set(
    publicRelease.checks.flatMap(({ reasons }) => reasons),
  )];
  const checks = [
    check("exact_public_release",
      publicRelease.outcome === "published" ? [] : publicReleaseReasons),
    inspectFirstPublicationStageOnlyWorkflow(workflow),
    inspectFirstPublicationNpmStageTrust(npmObservation, bootstrap.identity.repository),
    inspectFirstPublicationGitHubStageEnvironment(
      githubObservation,
      bootstrap.identity.repository,
    ),
  ];
  const body = {
    schemaVersion: 2,
    status: checks.every(({ status }) => status === "ready") ? "ready" : "blocked",
    bootstrapDigest: bootstrap.bootstrapDigest,
    publicationEvidence: evidence,
    observedAt,
    checks,
  };
  return { ...body, transitionReportDigest: canonicalDigest(body) };
}
