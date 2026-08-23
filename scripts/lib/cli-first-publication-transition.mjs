import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { readFirstPublicationTransitionSources } from
  "./first-publication-transition-sources.mjs";
import { createFirstPublicationTransitionReport } from
  "./first-publication-transition-policy.mjs";
import {
  createFirstPublicationTransitionReceipt,
  validateFirstPublicationTransitionReceipt,
  validateFirstPublicationTransitionReceiptDocument,
} from "./first-publication-transition.mjs";
import { observeGitHubPublisherEnvironment } from "./github-environment-observer.mjs";
import { observeFirstPublicationReconciliation } from
  "./npm-first-publication-reconciliation-observer.mjs";
import { observeNpmTrustedPublisher } from "./npm-trust-observer.mjs";

function fail(code = "first_publication_transition_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication transition completion input is invalid.",
  );
}

function validOptions(options) {
  const common = options?.online === true &&
    isAbsolute(options.publicationAuthorizationPath ?? "") &&
    isAbsolute(options.bootstrapPath ?? "") &&
    isAbsolute(options.workflowPath ?? "");
  if (!common) return false;
  const resolutionValues = [
    options.reservationRoot,
    options.reconciliationReportPath,
    options.decisionPath,
    options.resolutionPath,
  ];
  const stageValues = [
    options.stageApprovalReviewPath,
    options.stageApprovalDecisionPath,
    options.stageApprovalAuthorizationPath,
    options.stageApprovalResultDirectory,
    options.stageApprovalReconciliationPath,
  ];
  const stageBundle = options.stageApprovalBundlePath;
  if (options.evidenceType === "execution_receipt") {
    return isAbsolute(options.armingAuthorizationPath ?? "") &&
      isAbsolute(options.executionReceiptPath ?? "") &&
      resolutionValues.every((value) => value === undefined) &&
      stageValues.every((value) => value === undefined) && stageBundle === undefined;
  }
  if (options.evidenceType === "reconciliation_resolution") {
    return isAbsolute(options.armingAuthorizationPath ?? "") &&
      options.executionReceiptPath === undefined &&
      resolutionValues.every((value) => isAbsolute(value ?? "")) &&
      stageValues.every((value) => value === undefined) && stageBundle === undefined;
  }
  return options.evidenceType === "stage_approval_reconciliation" &&
    options.armingAuthorizationPath === undefined &&
    options.executionReceiptPath === undefined &&
    resolutionValues.every((value) => value === undefined) &&
    ((stageValues.every((value) => isAbsolute(value ?? "")) &&
      stageBundle === undefined) ||
      (stageValues.every((value) => value === undefined) &&
        isAbsolute(stageBundle ?? "")));
}

export async function completeCliFirstPublicationTransition(options, dependencies = {}) {
  if (!validOptions(options)) {
    fail(options?.online === true ? undefined : "first_publication_transition_online_required");
  }
  const readSources = dependencies.readSources ?? readFirstPublicationTransitionSources;
  const observePublicRelease = dependencies.observePublicRelease ??
    observeFirstPublicationReconciliation;
  const observeNpm = dependencies.observeNpm ?? observeNpmTrustedPublisher;
  const observeGitHub = dependencies.observeGitHub ?? observeGitHubPublisherEnvironment;
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const sources = await readSources(options, dependencies);
  const [publicReleaseObservation, npmObservation, githubObservation] = await Promise.all([
    observePublicRelease(sources.bootstrap.target),
    observeNpm(),
    observeGitHub({ repository: sources.bootstrap.identity.repository }),
  ]);
  const completedAt = clock();
  const evidence = {
    bootstrap: sources.bootstrap,
    armingAuthorization: sources.armingAuthorization,
    publicationAuthorization: sources.publicationAuthorization,
    publicationEvidence: sources.publicationEvidence,
    publicReleaseObservation,
    workflow: sources.workflow,
    npmObservation,
    githubObservation,
  };
  const report = createFirstPublicationTransitionReport({
    ...evidence,
    observedAt: completedAt,
  });
  await sources.assertUnchanged();
  if (report.status !== "ready") fail("first_publication_transition_not_ready");
  const receipt = createFirstPublicationTransitionReceipt({ ...evidence, completedAt });
  validateFirstPublicationTransitionReceipt(receipt, evidence);
  return receipt;
}

export async function writeFirstPublicationTransitionReceipt(outputPath, receipt) {
  if (!isAbsolute(outputPath ?? "")) fail();
  validateFirstPublicationTransitionReceiptDocument(receipt);
  try {
    await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") fail("first_publication_transition_output_exists");
    throw error;
  }
}
