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
    "CLI 최초 게시 전환 완료 명령 인자가 올바르지 않습니다.",
  );
}

function parseArguments(args) {
  const commonNames = [
    "--publication-authorization",
    "--bootstrap",
    "--arming-authorization",
    "--workflow",
    "--output",
  ];
  const resolutionNames = [
    "--reservation-root",
    "--reconciliation-report",
    "--decision",
    "--resolution",
  ];
  const allowed = [...commonNames, "--execution-receipt", ...resolutionNames];
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
  if (
    execution === resolution ||
    (execution && resolutionNames.some((name) => values.has(name))) ||
    (!execution && resolutionNames.some((name) => values.has(name)) && !resolution) ||
    (execution && !isAbsolute(values.get("--execution-receipt") ?? "")) ||
    (resolution && !resolutionNames.every((name) => isAbsolute(values.get(name) ?? "")))
  ) failArguments();
  const options = {
    online,
    publicationAuthorizationPath: values.get("--publication-authorization"),
    bootstrapPath: values.get("--bootstrap"),
    armingAuthorizationPath: values.get("--arming-authorization"),
    workflowPath: values.get("--workflow"),
    evidenceType: execution ? "execution_receipt" : "reconciliation_resolution",
  };
  if (execution) options.executionReceiptPath = values.get("--execution-receipt");
  else {
    options.reservationRoot = values.get("--reservation-root");
    options.reconciliationReportPath = values.get("--reconciliation-report");
    options.decisionPath = values.get("--decision");
    options.resolutionPath = values.get("--resolution");
  }
  return { options, outputPath: values.get("--output") };
}

try {
  const { options, outputPath } = parseArguments(process.argv.slice(2));
  const receipt = await completeCliFirstPublicationTransition(options);
  await writeFirstPublicationTransitionReceipt(outputPath, receipt);
  const evidence = receipt.publicationEvidence.type === "execution_receipt"
    ? "게시 실행 영수증"
    : "검토된 결과 대조";
  console.log(
    `CLI 최초 게시 전환 완료 (${evidence}, Trusted Publisher stage-only 전환)`,
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_transition_failed: CLI 최초 게시 전환을 완료하지 못했습니다.",
  );
  process.exitCode = 1;
}
