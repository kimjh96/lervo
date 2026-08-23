import { validateCliReleaseTag } from "./cli-release-attestation.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  maximumAnnotatedTagDepth,
  maximumRemoteCliPackageBytes,
  remoteCliPackagePath,
  validateGitHubDefaultBranch,
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import { remoteReleaseWorkflowPath } from
  "./first-publication-workflow-remote-source-contract.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const checkIds = Object.freeze([
  "remote_deployment_evidence",
  "package_identity",
  "source_package_at_commit",
  "exact_package_bytes",
  "default_branch_reference_stable",
  "source_commit_default_branch_reachability",
  "release_tag_reference_stable",
  "release_tag_exact_source_commit",
]);

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_reachability_report_invalid",
    "The CLI stage-only workflow ref-reachability evidence report is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail();
  return result;
}

export function createFirstPublicationWorkflowReachabilityReport({
  repository,
  sourceCommit,
  releaseTag,
  remoteEvidenceReport,
  cliPackage,
  reachabilityObservation,
  observedAt,
}) {
  const body = {
    schemaVersion: 1,
    status: "evidence_bound",
    evidenceType: "first_publication_stage_only_workflow_ref_reachability",
    target: {
      repository,
      sourceCommit,
      releaseTag,
      package: cliPackage.name,
      version: cliPackage.version,
      workflowPath: remoteReleaseWorkflowPath,
    },
    upstream: {
      remoteDeploymentEvidenceDigest: remoteEvidenceReport.evidenceDigest,
      remoteObservedAt: remoteEvidenceReport.remote.observedAt,
      workflowSha256: remoteEvidenceReport.remote.sha256,
    },
    github: {
      observedAt,
      sourcePackage: {
        path: reachabilityObservation.sourcePackage.path,
        gitBlobSha: reachabilityObservation.sourcePackage.blobSha,
        byteCount: reachabilityObservation.sourcePackage.byteCount,
        sha256: reachabilityObservation.sourcePackage.sha256,
      },
      defaultBranch: reachabilityObservation.defaultBranch,
      releaseTag: reachabilityObservation.releaseTag,
      referenceStability: reachabilityObservation.referenceStability,
    },
    checks: checkIds.map((id) => ({ id, status: "ready" })),
    reachability: "source_on_default_branch_and_exact_release_tag",
    limitations: {
      upstreamEvidenceAuthenticity: "not_verified",
      defaultBranchAfterObservation: "not_verified",
      releaseTagImmutability: "not_verified",
      workflowExecution: "not_observed",
      stageSubmission: "not_observed",
      publicAvailability: "not_observed",
    },
    sideEffects: {
      files: "not_changed",
      githubSettings: "not_changed",
      gitReferences: "observed_not_changed",
      workflowDispatch: "not_attempted",
      publication: "not_attempted",
    },
  };
  return { ...body, evidenceDigest: canonicalDigest(body) };
}

export function validateFirstPublicationWorkflowReachabilityReportDocument(report) {
  try {
    validateReadinessRepository(report?.target?.repository);
    validateWorkflowReachabilityCommit(report?.target?.sourceCommit);
    validateWorkflowReachabilityReleaseTag(report?.target?.releaseTag);
    validateCliReleaseTag(report?.target?.version, report?.target?.releaseTag);
    validateGitHubDefaultBranch(report?.github?.defaultBranch?.name);
    validateWorkflowReachabilityCommit(report?.github?.defaultBranch?.headCommit);
    validateWorkflowReachabilityCommit(report?.github?.releaseTag?.commit);
  } catch {
    fail();
  }
  const validTarget = exactKeys(report.target, [
    "repository", "sourceCommit", "releaseTag", "package", "version", "workflowPath",
  ]) && report.target.package === "@lervo/cli" &&
    report.target.workflowPath === remoteReleaseWorkflowPath;
  const validUpstream = exactKeys(report.upstream, [
    "remoteDeploymentEvidenceDigest", "remoteObservedAt", "workflowSha256",
  ]) && digestPattern.test(report.upstream.remoteDeploymentEvidenceDigest ?? "") &&
    digestPattern.test(report.upstream.workflowSha256 ?? "");
  const branch = report.github.defaultBranch;
  const sourcePackage = report.github.sourcePackage;
  const validSourcePackage = exactKeys(sourcePackage, [
    "path", "gitBlobSha", "byteCount", "sha256",
  ]) && sourcePackage.path === remoteCliPackagePath &&
    /^[a-f0-9]{40}$/u.test(sourcePackage.gitBlobSha ?? "") &&
    Number.isSafeInteger(sourcePackage.byteCount) && sourcePackage.byteCount > 0 &&
    sourcePackage.byteCount <= maximumRemoteCliPackageBytes &&
    digestPattern.test(sourcePackage.sha256 ?? "");
  const validBranch = exactKeys(branch, [
    "name", "headCommit", "relation", "commitsAhead",
  ]) && branch.relation === "source_commit_ancestor_or_equal" &&
    Number.isSafeInteger(branch.commitsAhead) && branch.commitsAhead >= 0 &&
    ((branch.headCommit === report.target.sourceCommit && branch.commitsAhead === 0) ||
      (branch.headCommit !== report.target.sourceCommit && branch.commitsAhead > 0));
  const tag = report.github.releaseTag;
  const validTag = exactKeys(tag, [
    "name", "kind", "annotatedDepth", "commit",
  ]) && tag.name === report.target.releaseTag &&
    ["lightweight", "annotated"].includes(tag.kind) &&
    Number.isSafeInteger(tag.annotatedDepth) &&
    ((tag.kind === "lightweight" && tag.annotatedDepth === 0) ||
      (tag.kind === "annotated" && tag.annotatedDepth >= 1 &&
        tag.annotatedDepth <= maximumAnnotatedTagDepth)) &&
    tag.commit === report.target.sourceCommit;
  const validGitHub = exactKeys(report.github, [
    "observedAt", "sourcePackage", "defaultBranch", "releaseTag",
    "referenceStability",
  ]) && validSourcePackage && validBranch && validTag &&
    report.github.referenceStability === "rechecked_unchanged";
  const validChecks = Array.isArray(report.checks) &&
    report.checks.length === checkIds.length && report.checks.every((check, index) =>
      exactKeys(check, ["id", "status"]) && check.id === checkIds[index] &&
      check.status === "ready"
    );
  const validLimitations = exactKeys(report.limitations, [
    "upstreamEvidenceAuthenticity", "defaultBranchAfterObservation",
    "releaseTagImmutability", "workflowExecution", "stageSubmission",
    "publicAvailability",
  ]) && canonicalJson(report.limitations) === canonicalJson({
    upstreamEvidenceAuthenticity: "not_verified",
    defaultBranchAfterObservation: "not_verified",
    releaseTagImmutability: "not_verified",
    workflowExecution: "not_observed",
    stageSubmission: "not_observed",
    publicAvailability: "not_observed",
  });
  const validSideEffects = exactKeys(report.sideEffects, [
    "files", "githubSettings", "gitReferences", "workflowDispatch", "publication",
  ]) && canonicalJson(report.sideEffects) === canonicalJson({
    files: "not_changed",
    githubSettings: "not_changed",
    gitReferences: "observed_not_changed",
    workflowDispatch: "not_attempted",
    publication: "not_attempted",
  });
  if (
    !exactKeys(report, [
      "schemaVersion", "status", "evidenceType", "target", "upstream", "github",
      "checks", "reachability", "limitations", "sideEffects", "evidenceDigest",
    ]) || report.schemaVersion !== 1 || report.status !== "evidence_bound" ||
    report.evidenceType !== "first_publication_stage_only_workflow_ref_reachability" ||
    report.reachability !== "source_on_default_branch_and_exact_release_tag" ||
    !validTarget || !validUpstream || !validGitHub || !validChecks ||
    !validLimitations || !validSideEffects ||
    !digestPattern.test(report.evidenceDigest ?? "") ||
    timestamp(report.github.observedAt) < timestamp(report.upstream.remoteObservedAt)
  ) fail();
  const { evidenceDigest, ...body } = report;
  if (evidenceDigest !== canonicalDigest(body)) fail();
  return report;
}
