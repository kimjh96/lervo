import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertFirstPublicationWorkflowReachabilityBinding,
  createFirstPublicationWorkflowReachabilityEvidence,
  validateFirstPublicationWorkflowReachabilityEvidence,
} from "./first-publication-workflow-reachability-evidence.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import {
  firstPublicationWorkflowReachabilityPaths,
  readFirstPublicationWorkflowReachabilitySources,
} from "./first-publication-workflow-reachability-sources.mjs";
import { observeGitHubWorkflowReachability } from
  "./github-workflow-reachability-observer.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function createCliFirstPublicationWorkflowReachabilityEvidence(
  { repository, sourceCommit, releaseTag, remoteEvidenceReportPath, online },
  dependencies = {},
) {
  if (online !== true) {
    fail(
      "first_publication_workflow_reachability_online_required",
      "CLI stage-only workflow ref-reachability evidence requires online verification.",
    );
  }
  try {
    validateReadinessRepository(repository);
    validateWorkflowReachabilityCommit(sourceCommit);
    validateWorkflowReachabilityReleaseTag(releaseTag);
  } catch {
    fail(
      "first_publication_workflow_reachability_input_invalid",
      "The CLI stage-only workflow ref-reachability evidence input is invalid.",
    );
  }
  const paths = dependencies.paths ?? firstPublicationWorkflowReachabilityPaths;
  const readSources = dependencies.readSources ??
    readFirstPublicationWorkflowReachabilitySources;
  const sources = await readSources(paths, remoteEvidenceReportPath);
  const binding = {
    repository,
    sourceCommit,
    releaseTag,
    remoteEvidenceReport: sources.remoteEvidenceReport,
    cliPackage: sources.cliPackage,
    packageSnapshot: sources.packageSnapshot,
  };
  assertFirstPublicationWorkflowReachabilityBinding(binding);
  const observeReachability = dependencies.observeReachability ??
    observeGitHubWorkflowReachability;
  const reachabilityObservation = await observeReachability({
    repository,
    sourceCommit,
    releaseTag,
  });
  const observedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  await sources.assertUnchanged();
  const input = { ...binding, reachabilityObservation, observedAt };
  const evidence = createFirstPublicationWorkflowReachabilityEvidence(input);
  return validateFirstPublicationWorkflowReachabilityEvidence(evidence, input);
}
