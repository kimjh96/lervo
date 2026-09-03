import { validateCliReleaseTag } from "../../lib/cli-release-attestation.mjs";
import { parseCanonicalReleaseJson } from "../../lib/bounded-release-json-source.mjs";
import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  maximumAnnotatedTagDepth,
  maximumRemoteCliPackageBytes,
  remoteCliPackagePath,
  validateGitHubDefaultBranch,
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import {
  createFirstPublicationWorkflowReachabilityReport,
  validateFirstPublicationWorkflowReachabilityReportDocument,
} from "./first-publication-workflow-reachability-report.mjs";
import { validateFirstPublicationWorkflowRemoteDeploymentReportDocument } from "./first-publication-workflow-remote-deployment-report.mjs";
import { canonicalJson, sha256 } from "../../../shared/release-artifact-manifest.mjs";
import {
  inspectTrustedPublisherPackage,
  validateReadinessRepository,
} from "../../lib/trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export function assertFirstPublicationWorkflowReachabilityBinding({
  repository,
  sourceCommit,
  releaseTag,
  remoteEvidenceReport,
  cliPackage,
  packageSnapshot,
}) {
  try {
    validateReadinessRepository(repository);
    validateWorkflowReachabilityCommit(sourceCommit);
    validateWorkflowReachabilityReleaseTag(releaseTag);
    validateFirstPublicationWorkflowRemoteDeploymentReportDocument(remoteEvidenceReport);
    validateCliReleaseTag(cliPackage?.version, releaseTag);
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail(
      "first_publication_workflow_reachability_input_invalid",
      "The CLI stage-only workflow ref-reachability evidence input is invalid.",
    );
  }
  if (
    remoteEvidenceReport.target.repository !== repository ||
    remoteEvidenceReport.target.sourceCommit !== sourceCommit ||
    remoteEvidenceReport.target.package !== cliPackage?.name ||
    inspectTrustedPublisherPackage(cliPackage, repository).status !== "ready" ||
    !Buffer.isBuffer(packageSnapshot?.contents) ||
    packageSnapshot.byteCount !== packageSnapshot.contents.length ||
    packageSnapshot.sha256 !== sha256(packageSnapshot.contents)
  ) {
    fail(
      "first_publication_workflow_reachability_source_mismatch",
      "The remote-deployment evidence does not match the current package and target ref.",
    );
  }
  let snapshotPackage;
  try {
    snapshotPackage = parseCanonicalReleaseJson(packageSnapshot.contents);
  } catch {
    fail(
      "first_publication_workflow_reachability_source_mismatch",
      "The remote-deployment evidence does not match the current package and target ref.",
    );
  }
  if (canonicalJson(snapshotPackage) !== canonicalJson(cliPackage)) {
    fail(
      "first_publication_workflow_reachability_source_mismatch",
      "The remote-deployment evidence does not match the current package and target ref.",
    );
  }
  return remoteEvidenceReport;
}

function validateObservation(observation, input) {
  if (observation?.state !== "observed") {
    fail(
      "first_publication_workflow_reachability_not_ready",
      "GitHub default-branch and release-tag reachability could not be confirmed.",
    );
  }
  const exactKeys = (value, keys) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
  if (
    !exactKeys(observation, [
      "schemaVersion",
      "source",
      "state",
      "repository",
      "sourceCommit",
      "defaultBranch",
      "releaseTag",
      "sourcePackage",
      "referenceStability",
    ]) ||
    observation.schemaVersion !== 1 ||
    observation.source !== "github_repository_reachability" ||
    observation.repository !== input.repository ||
    observation.sourceCommit !== input.sourceCommit ||
    observation.referenceStability !== "rechecked_unchanged" ||
    !exactKeys(observation.defaultBranch, ["name", "headCommit", "relation", "commitsAhead"]) ||
    !exactKeys(observation.releaseTag, ["name", "kind", "annotatedDepth", "commit"]) ||
    !exactKeys(observation.sourcePackage, ["path", "blobSha", "byteCount", "sha256", "contents"])
  ) {
    fail(
      "first_publication_workflow_reachability_observation_invalid",
      "The GitHub ref-reachability observation is invalid.",
    );
  }
  try {
    validateGitHubDefaultBranch(observation.defaultBranch.name);
    validateWorkflowReachabilityCommit(observation.defaultBranch.headCommit);
    validateWorkflowReachabilityReleaseTag(observation.releaseTag.name);
    validateWorkflowReachabilityCommit(observation.releaseTag.commit);
  } catch {
    fail(
      "first_publication_workflow_reachability_observation_invalid",
      "The GitHub ref-reachability observation is invalid.",
    );
  }
  const branch = observation.defaultBranch;
  const tag = observation.releaseTag;
  const sourcePackage = observation.sourcePackage;
  const validShape =
    Number.isSafeInteger(branch.commitsAhead) &&
    branch.commitsAhead >= 0 &&
    ["lightweight", "annotated"].includes(tag.kind) &&
    Number.isSafeInteger(tag.annotatedDepth) &&
    ((tag.kind === "lightweight" && tag.annotatedDepth === 0) ||
      (tag.kind === "annotated" &&
        tag.annotatedDepth >= 1 &&
        tag.annotatedDepth <= maximumAnnotatedTagDepth)) &&
    sourcePackage.path === remoteCliPackagePath &&
    /^[a-f0-9]{40}$/u.test(sourcePackage.blobSha ?? "") &&
    Buffer.isBuffer(sourcePackage.contents) &&
    sourcePackage.contents.length > 0 &&
    sourcePackage.contents.length <= maximumRemoteCliPackageBytes &&
    sourcePackage.byteCount === sourcePackage.contents.length &&
    sourcePackage.sha256 === sha256(sourcePackage.contents);
  if (!validShape || tag.name !== input.releaseTag) {
    fail(
      "first_publication_workflow_reachability_observation_invalid",
      "The GitHub ref-reachability observation is invalid.",
    );
  }
  if (branch.relation !== "source_commit_ancestor_or_equal" || tag.commit !== input.sourceCommit) {
    fail(
      "first_publication_workflow_reachability_not_ready",
      "The source commit is not bound to both the default branch and the exact release tag.",
    );
  }
  if (
    sourcePackage.sha256 !== input.packageSnapshot.sha256 ||
    !sourcePackage.contents.equals(input.packageSnapshot.contents)
  ) {
    fail(
      "first_publication_workflow_reachability_source_mismatch",
      "The source commit package does not match the currently verified package.",
    );
  }
  return observation;
}

function validatedInput(input) {
  assertFirstPublicationWorkflowReachabilityBinding(input);
  return {
    ...input,
    reachabilityObservation: validateObservation(input.reachabilityObservation, input),
  };
}

export function createFirstPublicationWorkflowReachabilityEvidence(input) {
  const report = createFirstPublicationWorkflowReachabilityReport(validatedInput(input));
  return validateFirstPublicationWorkflowReachabilityReportDocument(report);
}

export function validateFirstPublicationWorkflowReachabilityEvidence(report, input) {
  validateFirstPublicationWorkflowReachabilityReportDocument(report);
  const expected = createFirstPublicationWorkflowReachabilityEvidence(input);
  if (canonicalJson(report) !== canonicalJson(expected)) {
    fail(
      "first_publication_workflow_reachability_report_invalid",
      "The CLI stage-only workflow ref-reachability evidence report is invalid.",
    );
  }
  return report;
}
