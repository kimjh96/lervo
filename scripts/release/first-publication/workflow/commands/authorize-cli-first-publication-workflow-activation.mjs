import { isAbsolute } from "node:path";

import { authorizeCliFirstPublicationWorkflowActivation } from "../cli-first-publication-workflow-activation-permit.mjs";
import { FirstPublicationBootstrapError } from "../../transition/first-publication-bootstrap.mjs";
import { formatFirstPublicationWorkflowActivationPermit } from "../first-publication-workflow-activation-permit-formatter.mjs";
import { ReleaseAttestationVerificationError } from "../../../lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from "../../../lib/trusted-publisher-readiness.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_activation_permit_arguments_invalid",
    "The CLI first-publication workflow activation authorization command arguments are invalid.",
  );
}

function parseArguments(args) {
  const values = new Map();
  let online = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--online" && !online) {
      online = true;
      continue;
    }
    if (
      !["--repository", "--decision", "--output"].includes(name) ||
      values.has(name) ||
      index + 1 >= args.length
    )
      failArguments();
    values.set(name, args[index + 1]);
    index += 1;
  }
  if (
    !online ||
    values.size !== 3 ||
    !isAbsolute(values.get("--decision") ?? "") ||
    !isAbsolute(values.get("--output") ?? "")
  )
    failArguments();
  return {
    repository: values.get("--repository"),
    decisionPath: values.get("--decision"),
    outputPath: values.get("--output"),
    online,
  };
}

try {
  const permit = await authorizeCliFirstPublicationWorkflowActivation(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(formatFirstPublicationWorkflowActivationPermit(permit));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof TrustedPublisherReadinessError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_workflow_activation_permit_failed: " +
        "The CLI first-publication workflow activation authorization could not be created.",
    );
  process.exitCode = 1;
}
