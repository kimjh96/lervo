import { inspectCliFirstPublicationPackageMetadataApplyPermit } from
  "./lib/cli-first-publication-package-metadata-apply-permit.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { createFirstPublicationMetadataDecision } from
  "./lib/first-publication-metadata-decision.mjs";
import { parseFirstPublicationMetadataArguments } from
  "./lib/first-publication-metadata-cli-arguments.mjs";
import { formatFirstPublicationPackageMetadataApplyPermit } from
  "./lib/first-publication-package-metadata-apply-permit-formatter.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";

try {
  const { output, decisionInput, review } = parseFirstPublicationMetadataArguments(
    process.argv.slice(2),
    "permit",
  );
  const decision = createFirstPublicationMetadataDecision(decisionInput);
  const permit = await inspectCliFirstPublicationPackageMetadataApplyPermit(decision, review);
  process.stdout.write(output === "json"
    ? `${JSON.stringify(permit, null, 2)}\n`
    : formatFirstPublicationPackageMetadataApplyPermit(permit));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_package_metadata_apply_permit_failed: The CLI first-publication package metadata apply permit could not be created.",
  );
  process.exitCode = 1;
}
