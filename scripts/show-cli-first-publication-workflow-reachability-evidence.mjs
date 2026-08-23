import { createCliFirstPublicationWorkflowReachabilityEvidence } from
  "./lib/cli-first-publication-workflow-reachability.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationWorkflowReachabilityArguments } from
  "./lib/first-publication-workflow-reachability-cli-arguments.mjs";
import { formatFirstPublicationWorkflowReachabilityEvidence } from
  "./lib/first-publication-workflow-reachability-formatter.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from
  "./lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationWorkflowReachabilityArguments(
    process.argv.slice(2),
  );
  const evidence = await createCliFirstPublicationWorkflowReachabilityEvidence(parsed);
  process.stdout.write(parsed.json
    ? `${JSON.stringify(evidence, null, 2)}\n`
    : formatFirstPublicationWorkflowReachabilityEvidence(evidence));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof TrustedPublisherReadinessError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_workflow_reachability_unexpected: " +
    "CLI stage-only workflow ref-reachability evidence could not be created.",
  );
  process.exitCode = 1;
}
