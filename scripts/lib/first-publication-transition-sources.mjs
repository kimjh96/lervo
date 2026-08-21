import { isAbsolute } from "node:path";

import { parse } from "yaml";

import {
  validateFirstPublicationArmingAuthorization,
  validateFirstPublicationArmingAuthorizationDocument,
} from "./first-publication-arming-authorization.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { readFirstPublicationContractFiles } from
  "./first-publication-contract-files.mjs";
import { validateFirstPublicationExecutionReceipt } from
  "./first-publication-execution-receipt.mjs";
import { readFirstPublicationResolutionSources } from
  "./first-publication-resolution-sources.mjs";
import { readFirstPublicationStageEvidenceBundleSources } from
  "./first-publication-stage-evidence-bundle-sources.mjs";
import { readFirstPublicationStageEvidenceSetSources } from
  "./first-publication-stage-evidence-set-sources.mjs";
import { validateFirstPublicationResolutionDocument } from
  "./first-publication-resolution.mjs";
import { resolveFirstPublicationTransitionEvidence } from
  "./first-publication-transition-evidence.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumDocumentBytes = 64 * 1024;
const maximumWorkflowBytes = 256 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_transition_source_invalid",
    "CLI 최초 게시 전환 원본이 올바르지 않습니다.",
  );
}

function parseJson(contents) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
}

function parseWorkflow(contents) {
  try {
    const workflow = parse(contents.toString("utf8"));
    if (workflow === null || typeof workflow !== "object" || Array.isArray(workflow)) fail();
    return workflow;
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
}

async function readSnapshot(path, maximumSize = maximumDocumentBytes) {
  try {
    const contents = await readRegularReleaseFile(path, maximumSize);
    return { path, contents, maximumSize };
  } catch {
    fail();
  }
}

async function readWorkflow(path) {
  if (!isAbsolute(path ?? "")) fail();
  const snapshot = await readSnapshot(path, maximumWorkflowBytes);
  return { workflow: parseWorkflow(snapshot.contents), snapshot };
}

async function readExecutionSources(options) {
  if (
    !isAbsolute(options?.armingAuthorizationPath ?? "") ||
    !isAbsolute(options?.executionReceiptPath ?? "")
  ) fail();
  const contracts = await readFirstPublicationContractFiles(options);
  const [armingSnapshot, receiptSnapshot] = await Promise.all([
    readSnapshot(options.armingAuthorizationPath),
    readSnapshot(options.executionReceiptPath),
  ]);
  const armingAuthorization = validateFirstPublicationArmingAuthorizationDocument(
    parseJson(armingSnapshot.contents),
  );
  validateFirstPublicationArmingAuthorization(armingAuthorization, {
    ...contracts,
    checkedAt: armingAuthorization.validity.armedAt,
  });
  const executionReceipt = parseJson(receiptSnapshot.contents);
  validateFirstPublicationExecutionReceipt(executionReceipt, {
    ...contracts,
    armingAuthorization,
  });
  return {
    ...contracts,
    armingAuthorization,
    publicationEvidence: { type: "execution_receipt", executionReceipt },
    assertUnchanged: async () => {
      await Promise.all([
        contracts.assertUnchanged(),
        assertReleaseFilesUnchanged([armingSnapshot, receiptSnapshot]),
      ]);
    },
  };
}

async function readResolutionSources(options, dependencies) {
  if (!isAbsolute(options?.resolutionPath ?? "")) fail();
  const sources = await readFirstPublicationResolutionSources(options, dependencies);
  const resolutionSnapshot = await readSnapshot(options.resolutionPath);
  const resolution = validateFirstPublicationResolutionDocument(
    parseJson(resolutionSnapshot.contents),
  );
  const publicationEvidence = {
    type: "reconciliation_resolution",
    resolution,
    reconciliationReport: sources.reconciliationReport,
    decision: sources.decision,
    reservation: sources.reservation,
    terminal: sources.terminal,
  };
  resolveFirstPublicationTransitionEvidence(publicationEvidence, sources);
  return {
    ...sources,
    publicationEvidence,
    assertUnchanged: async () => {
      await Promise.all([
        sources.assertUnchanged(),
        assertReleaseFilesUnchanged([resolutionSnapshot]),
      ]);
    },
  };
}

async function readStageApprovalSources(options, dependencies) {
  const readStageSources = options.stageApprovalBundlePath === undefined
    ? readFirstPublicationStageEvidenceSetSources
    : readFirstPublicationStageEvidenceBundleSources;
  const stageInput = options.stageApprovalBundlePath === undefined
    ? {
        stageReviewReportPath: options.stageApprovalReviewPath,
        decisionPath: options.stageApprovalDecisionPath,
        authorizationPath: options.stageApprovalAuthorizationPath,
        resultDirectory: options.stageApprovalResultDirectory,
        reconciliationReportPath: options.stageApprovalReconciliationPath,
      }
    : options.stageApprovalBundlePath;
  const [contracts, stageSources] = await Promise.all([
    readFirstPublicationContractFiles(options),
    readStageSources(stageInput, dependencies),
  ]);
  const publicationEvidence = {
    type: "stage_approval_reconciliation",
    reconciliationReport: stageSources.reconciliationReport,
    stageReviewReport: stageSources.stageReviewReport,
    decision: stageSources.decision,
    authorization: stageSources.authorization,
    attempt: stageSources.attempt,
    terminal: stageSources.terminal,
  };
  resolveFirstPublicationTransitionEvidence(publicationEvidence, contracts);
  return {
    ...contracts,
    publicationEvidence,
    assertUnchanged: async () => {
      await Promise.all([
        contracts.assertUnchanged(),
        stageSources.assertUnchanged(),
      ]);
    },
  };
}

export async function readFirstPublicationTransitionSources(options, dependencies = {}) {
  if (
    ![
      "execution_receipt", "reconciliation_resolution", "stage_approval_reconciliation",
    ].includes(options?.evidenceType) ||
    !isAbsolute(options?.publicationAuthorizationPath ?? "") ||
    !isAbsolute(options?.bootstrapPath ?? "")
  ) fail();
  const [sources, workflowSource] = await Promise.all([
    options.evidenceType === "execution_receipt"
      ? readExecutionSources(options)
      : options.evidenceType === "reconciliation_resolution"
        ? readResolutionSources(options, dependencies)
        : readStageApprovalSources(options, dependencies),
    readWorkflow(options.workflowPath),
  ]);
  return {
    ...sources,
    workflow: workflowSource.workflow,
    assertUnchanged: async () => {
      await Promise.all([
        sources.assertUnchanged(),
        assertReleaseFilesUnchanged([workflowSource.snapshot]),
      ]);
    },
  };
}
