import { isAbsolute } from "node:path";

import {
  completeCliFirstPublicationTransition,
  writeFirstPublicationTransitionReceipt,
} from "./lib/cli-first-publication-transition.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from
  "./lib/release-publication-authorization.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_transition_arguments_invalid",
    "The CLI first-publication transition completion command arguments are invalid.",
  );
}

function parseArguments(args) {
  const commonNames = [
    "--publication-authorization",
    "--bootstrap",
    "--workflow",
    "--output",
  ];
  const resolutionNames = [
    "--reservation-root",
    "--reconciliation-report",
    "--decision",
    "--resolution",
  ];
  const stageNames = [
    "--stage-approval-review",
    "--stage-approval-decision",
    "--stage-approval-authorization",
    "--stage-approval-result-directory",
    "--stage-approval-reconciliation",
  ];
  const allowed = [
    ...commonNames, "--arming-authorization", "--execution-receipt",
    ...resolutionNames, ...stageNames, "--stage-approval-bundle",
  ];
  const values = new Map();
  let online = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--online") {
      if (online) failArguments();
      online = true;
      continue;
    }
    const value = args[index + 1];
    if (
      !allowed.includes(name) || values.has(name) || value === undefined ||
      value.startsWith("--")
    ) failArguments();
    values.set(name, value);
    index += 1;
  }
  if (!online || !commonNames.every((name) => isAbsolute(values.get(name) ?? ""))) {
    failArguments();
  }
  const execution = values.has("--execution-receipt");
  const resolution = resolutionNames.every((name) => values.has(name));
  const stageDirect = stageNames.every((name) => values.has(name));
  const stageBundle = values.has("--stage-approval-bundle");
  const stageApproval = stageDirect || stageBundle;
  const arming = values.has("--arming-authorization");
  if (
    [execution, resolution, stageApproval].filter(Boolean).length !== 1 ||
    arming !== (execution || resolution) ||
    (execution && resolutionNames.some((name) => values.has(name))) ||
    ((execution || resolution) &&
      (stageNames.some((name) => values.has(name)) || stageBundle)) ||
    (!execution && resolutionNames.some((name) => values.has(name)) && !resolution) ||
    (!stageDirect && stageNames.some((name) => values.has(name))) ||
    (stageDirect && stageBundle) ||
    (execution && !isAbsolute(values.get("--execution-receipt") ?? "")) ||
    (resolution && !resolutionNames.every((name) => isAbsolute(values.get(name) ?? ""))) ||
    (stageDirect && !stageNames.every((name) => isAbsolute(values.get(name) ?? ""))) ||
    (stageBundle && !isAbsolute(values.get("--stage-approval-bundle") ?? "")) ||
    (arming && !isAbsolute(values.get("--arming-authorization") ?? ""))
  ) failArguments();
  const options = {
    online,
    publicationAuthorizationPath: values.get("--publication-authorization"),
    bootstrapPath: values.get("--bootstrap"),
    workflowPath: values.get("--workflow"),
    evidenceType: execution
      ? "execution_receipt"
      : resolution
        ? "reconciliation_resolution"
        : "stage_approval_reconciliation",
  };
  if (arming) options.armingAuthorizationPath = values.get("--arming-authorization");
  if (execution) {
    options.executionReceiptPath = values.get("--execution-receipt");
  } else if (resolution) {
    options.reservationRoot = values.get("--reservation-root");
    options.reconciliationReportPath = values.get("--reconciliation-report");
    options.decisionPath = values.get("--decision");
    options.resolutionPath = values.get("--resolution");
  } else if (stageDirect) {
    options.stageApprovalReviewPath = values.get("--stage-approval-review");
    options.stageApprovalDecisionPath = values.get("--stage-approval-decision");
    options.stageApprovalAuthorizationPath = values.get("--stage-approval-authorization");
    options.stageApprovalResultDirectory = values.get("--stage-approval-result-directory");
    options.stageApprovalReconciliationPath = values.get(
      "--stage-approval-reconciliation",
    );
  } else {
    options.stageApprovalBundlePath = values.get("--stage-approval-bundle");
  }
  return { options, outputPath: values.get("--output") };
}

try {
  const { options, outputPath } = parseArguments(process.argv.slice(2));
  const receipt = await completeCliFirstPublicationTransition(options);
  await writeFirstPublicationTransitionReceipt(outputPath, receipt);
  const evidence = receipt.publicationEvidence.type === "execution_receipt"
    ? "publication execution receipt"
    : receipt.publicationEvidence.type === "reconciliation_resolution"
      ? "reviewed result reconciliation"
      : "verified npm stage approval reconciliation";
  console.log(
    `CLI first-publication transition complete (${evidence}, Trusted Publisher stage-only transition)`,
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_transition_failed: The CLI first-publication transition could not be completed.",
  );
  process.exitCode = 1;
}
