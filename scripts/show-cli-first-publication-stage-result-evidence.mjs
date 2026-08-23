import { createCliFirstPublicationStageResultEvidence } from
  "./lib/cli-first-publication-stage-result.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationStageResultArguments } from
  "./lib/first-publication-stage-result-cli-arguments.mjs";
import { formatFirstPublicationStageResultEvidence } from
  "./lib/first-publication-stage-result-formatter.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from
  "./lib/release-publication-authorization.mjs";
import { TrustedPublisherReadinessError } from
  "./lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationStageResultArguments(process.argv.slice(2));
  const evidence = await createCliFirstPublicationStageResultEvidence(parsed);
  process.stdout.write(parsed.json
    ? `${JSON.stringify(evidence, null, 2)}\n`
    : formatFirstPublicationStageResultEvidence(evidence));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError ||
    error instanceof TrustedPublisherReadinessError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_stage_result_unexpected: " +
    "CLI npm stage-result evidence could not be created.",
  );
  process.exitCode = 1;
}
