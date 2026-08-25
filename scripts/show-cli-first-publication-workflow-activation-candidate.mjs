import { inspectCliFirstPublicationWorkflowActivationCandidate } from "./lib/cli-first-publication-workflow-activation-candidate.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { formatFirstPublicationWorkflowActivationCandidate } from "./lib/first-publication-workflow-activation-candidate-formatter.mjs";
import { ReleaseAttestationVerificationError } from "./lib/release-attestation-consumer.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_activation_candidate_arguments_invalid",
    "The CLI first-publication workflow activation candidate command arguments are invalid.",
  );
}

function parseArguments(args) {
  let json = false;
  let workflowYaml = false;
  for (const argument of args) {
    if (argument === "--json" && !json) json = true;
    else if (argument === "--workflow-yaml" && !workflowYaml) workflowYaml = true;
    else failArguments();
  }
  if (json && workflowYaml) failArguments();
  return { json, workflowYaml };
}

try {
  const { json, workflowYaml } = parseArguments(process.argv.slice(2));
  const result = await inspectCliFirstPublicationWorkflowActivationCandidate();
  if (workflowYaml) process.stdout.write(result.outputBytes);
  else if (json) process.stdout.write(`${JSON.stringify(result.candidate, null, 2)}\n`);
  else process.stdout.write(formatFirstPublicationWorkflowActivationCandidate(result.candidate));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_workflow_activation_candidate_failed: " +
        "The CLI first-publication workflow activation candidate could not be created.",
    );
  process.exitCode = 1;
}
