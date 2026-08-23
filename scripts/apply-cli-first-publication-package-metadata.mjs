import {
  applyCliFirstPublicationPackageMetadata,
  recoverCliFirstPublicationPackageMetadata,
} from "./lib/cli-first-publication-package-metadata-apply.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationPackageMetadataApplyArguments } from
  "./lib/first-publication-package-metadata-apply-cli-arguments.mjs";
import {
  formatFirstPublicationPackageMetadataApplyReceipt,
  formatFirstPublicationPackageMetadataRecovery,
} from "./lib/first-publication-package-metadata-apply-formatter.mjs";
import { ReleaseArtifactManifestError } from "./lib/release-artifact-manifest.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";

try {
  const parsed = parseFirstPublicationPackageMetadataApplyArguments(process.argv.slice(2));
  const result = parsed.mode === "recover"
    ? await recoverCliFirstPublicationPackageMetadata()
    : await applyCliFirstPublicationPackageMetadata(parsed.permitPath);
  process.stdout.write(parsed.json
    ? `${JSON.stringify(result, null, 2)}\n`
    : parsed.mode === "recover"
    ? formatFirstPublicationPackageMetadataRecovery(result)
    : formatFirstPublicationPackageMetadataApplyReceipt(result));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseArtifactManifestError ||
    error instanceof ReleaseAttestationVerificationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_package_metadata_apply_unexpected: The CLI first-publication package metadata apply could not be completed.",
  );
  process.exitCode = 1;
}
