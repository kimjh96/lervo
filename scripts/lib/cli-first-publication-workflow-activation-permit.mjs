import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { observeGitHubPublisherEnvironment } from "./github-environment-observer.mjs";
import { observeNpmTrustedPublisher } from "./npm-trust-observer.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationWorkflowActivationDecision } from "./first-publication-workflow-activation-decision.mjs";
import {
  createFirstPublicationWorkflowActivationCandidate,
  validateFirstPublicationWorkflowActivationCandidate,
} from "./first-publication-workflow-activation-candidate.mjs";
import {
  createFirstPublicationWorkflowActivationPermit,
  validateFirstPublicationWorkflowActivationPermit,
} from "./first-publication-workflow-activation-permit.mjs";
import {
  firstPublicationWorkflowActivationPaths,
  readFirstPublicationWorkflowActivationPermitSources,
} from "./first-publication-workflow-activation-permit-sources.mjs";
import {
  createTrustedPublisherReadinessReport,
  validateReadinessRepository,
} from "./trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function authorizeCliFirstPublicationWorkflowActivation(
  { repository, decisionPath, outputPath, online },
  dependencies = {},
) {
  if (online !== true || !isAbsolute(decisionPath ?? "") || !isAbsolute(outputPath ?? ""))
    fail(
      online === true
        ? "first_publication_workflow_activation_permit_arguments_invalid"
        : "first_publication_workflow_activation_permit_online_required",
      "The CLI first-publication workflow activation authorization input is invalid.",
    );
  validateReadinessRepository(repository);
  const paths = dependencies.paths ?? firstPublicationWorkflowActivationPaths;
  const readSources =
    dependencies.readSources ?? readFirstPublicationWorkflowActivationPermitSources;
  const sources = await readSources(paths, decisionPath);
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  validateFirstPublicationWorkflowActivationDecision(sources.decision, {
    checkedAt: clock(),
  });
  const candidateInput = {
    packageManifest: sources.packageManifest,
    workflow: sources.workflow,
    packageSnapshot: sources.packageSnapshot,
    workflowSnapshot: sources.workflowSnapshot,
  };
  const candidateResult = createFirstPublicationWorkflowActivationCandidate(candidateInput);
  validateFirstPublicationWorkflowActivationCandidate(candidateResult, candidateInput);
  const observeNpm = dependencies.observeNpm ?? observeNpmTrustedPublisher;
  const observeGitHub = dependencies.observeGitHub ?? observeGitHubPublisherEnvironment;
  const [npmObservation, githubObservation] = await Promise.all([
    observeNpm(),
    observeGitHub({ repository }),
  ]);
  const observedAt = clock();
  const readinessReport = createTrustedPublisherReadinessReport({
    repository,
    packageManifest: sources.cliPackageManifest,
    workflow: sources.workflow,
    npmObservation,
    githubObservation,
  });
  const permitInput = {
    candidateResult,
    candidateInput,
    decision: sources.decision,
    readinessReport,
    repository,
    packageManifest: sources.cliPackageManifest,
    workflow: sources.workflow,
    observedAt,
  };
  const permit = createFirstPublicationWorkflowActivationPermit(permitInput);
  validateFirstPublicationWorkflowActivationPermit(permit, permitInput, {
    checkedAt: observedAt,
  });
  await sources.assertUnchanged();
  try {
    await writeFile(outputPath, `${JSON.stringify(permit, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST")
      fail(
        "first_publication_workflow_activation_permit_output_exists",
        "The CLI first-publication workflow activation authorization output already exists.",
      );
    throw error;
  }
  return permit;
}

export { firstPublicationWorkflowActivationPaths };
