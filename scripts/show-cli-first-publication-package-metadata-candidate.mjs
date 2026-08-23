import { inspectCliFirstPublicationPackageMetadataCandidate } from
  "./lib/cli-first-publication-package-metadata-candidate.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { createFirstPublicationMetadataDecision } from
  "./lib/first-publication-metadata-decision.mjs";
import { parseFirstPublicationMetadataArguments } from
  "./lib/first-publication-metadata-cli-arguments.mjs";
import { formatFirstPublicationPackageMetadataCandidate } from
  "./lib/first-publication-package-metadata-candidate-formatter.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";

try {
  const { output, decisionInput } = parseFirstPublicationMetadataArguments(
    process.argv.slice(2),
    "candidate",
  );
  const decision = createFirstPublicationMetadataDecision(decisionInput);
  const result = await inspectCliFirstPublicationPackageMetadataCandidate(decision);
  if (output === "package_json") process.stdout.write(result.outputBytes);
  else if (output === "json") process.stdout.write(`${JSON.stringify(result.candidate, null, 2)}\n`);
  else process.stdout.write(formatFirstPublicationPackageMetadataCandidate(result.candidate));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_package_metadata_candidate_failed: The CLI first-publication package metadata candidate could not be created.",
  );
  process.exitCode = 1;
}
