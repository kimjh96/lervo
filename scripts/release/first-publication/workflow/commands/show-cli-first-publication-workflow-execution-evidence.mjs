import { createCliFirstPublicationWorkflowExecutionEvidence } from "../cli-first-publication-workflow-execution.mjs";
import { FirstPublicationBootstrapError } from "../../transition/first-publication-bootstrap.mjs";
import { parseFirstPublicationWorkflowExecutionArguments } from "../first-publication-workflow-execution-cli-arguments.mjs";
import { formatFirstPublicationWorkflowExecutionEvidence } from "../first-publication-workflow-execution-formatter.mjs";
import { ReleaseAttestationVerificationError } from "../../../lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from "../../../lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationWorkflowExecutionArguments(process.argv.slice(2));
  const evidence = await createCliFirstPublicationWorkflowExecutionEvidence(parsed);
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(evidence, null, 2)}\n`
      : formatFirstPublicationWorkflowExecutionEvidence(evidence),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof TrustedPublisherReadinessError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_workflow_execution_unexpected: " +
        "CLI stage-only workflow execution evidence could not be created.",
    );
  process.exitCode = 1;
}
