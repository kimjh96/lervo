import { verifyCliFirstPublicationPackageMetadataPostApply } from "./lib/cli-first-publication-package-metadata-post-apply.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationPackageMetadataPostApplyArguments } from "./lib/first-publication-package-metadata-post-apply-cli-arguments.mjs";
import { formatFirstPublicationPackageMetadataPostApplyReport } from "./lib/first-publication-package-metadata-post-apply-formatter.mjs";
import { ReleaseArtifactManifestError } from "./lib/release-artifact-manifest.mjs";
import { ReleaseAttestationVerificationError } from "./lib/release-attestation-consumer.mjs";

try {
  const parsed = parseFirstPublicationPackageMetadataPostApplyArguments(process.argv.slice(2));
  const report = await verifyCliFirstPublicationPackageMetadataPostApply(parsed.receiptPath);
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatFirstPublicationPackageMetadataPostApplyReport(report),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseArtifactManifestError ||
    error instanceof ReleaseAttestationVerificationError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_package_metadata_post_apply_unexpected: CLI first-publication package metadata post-apply verification could not be completed.",
    );
  process.exitCode = 1;
}
