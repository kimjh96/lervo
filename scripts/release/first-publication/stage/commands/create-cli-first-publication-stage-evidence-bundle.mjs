import { createCliFirstPublicationStageEvidenceBundle } from "../cli-first-publication-stage-evidence-bundle.mjs";
import { FirstPublicationBootstrapError } from "../../transition/first-publication-bootstrap.mjs";
import { parseFirstPublicationStageEvidenceBundleArguments } from "../first-publication-stage-evidence-bundle-cli-arguments.mjs";
import { formatFirstPublicationStageEvidenceBundle } from "../first-publication-stage-evidence-bundle-formatter.mjs";
import { ReleaseAttestationVerificationError } from "../../../lib/release-attestation-consumer.mjs";

try {
  const input = parseFirstPublicationStageEvidenceBundleArguments(process.argv.slice(2));
  const bundle = await createCliFirstPublicationStageEvidenceBundle(input);
  process.stdout.write(
    input.json
      ? `${JSON.stringify(bundle, null, 2)}\n`
      : formatFirstPublicationStageEvidenceBundle(bundle),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_stage_evidence_bundle_unexpected: " +
        "The CLI first-publication stage evidence bundle could not be created.",
    );
  process.exitCode = 1;
}
