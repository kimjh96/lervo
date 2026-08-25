import { executeCliFirstPublicationStageApproval } from "./lib/cli-first-publication-stage-approval-execution.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationStageApprovalExecutionArguments } from "./lib/first-publication-stage-approval-execution-cli-arguments.mjs";
import { formatFirstPublicationStageApprovalExecution } from "./lib/first-publication-stage-approval-execution-formatter.mjs";
import { ReleaseAttestationVerificationError } from "./lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from "./lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationStageApprovalExecutionArguments(process.argv.slice(2));
  const terminal = await executeCliFirstPublicationStageApproval(parsed);
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(terminal, null, 2)}\n`
      : formatFirstPublicationStageApprovalExecution(terminal),
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
      "first_publication_stage_approval_execution_unexpected: " +
        "CLI npm stage approval could not be executed.",
    );
  process.exitCode = 1;
}
