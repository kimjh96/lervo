import { inspectCliFirstPublicationMetadataPreview } from
  "./lib/cli-first-publication-metadata-preview.mjs";
import { createFirstPublicationMetadataDecision } from
  "./lib/first-publication-metadata-decision.mjs";
import { parseFirstPublicationMetadataArguments } from
  "./lib/first-publication-metadata-cli-arguments.mjs";
import { formatFirstPublicationMetadataPreview } from
  "./lib/first-publication-metadata-preview-formatter.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";

try {
  const { output, decisionInput } = parseFirstPublicationMetadataArguments(
    process.argv.slice(2),
    "preview",
  );
  const decision = createFirstPublicationMetadataDecision(decisionInput);
  const preview = await inspectCliFirstPublicationMetadataPreview(decision);
  process.stdout.write(output === "json"
    ? `${JSON.stringify(preview, null, 2)}\n`
    : formatFirstPublicationMetadataPreview(preview));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_metadata_preview_failed: CLI 최초 게시 metadata 변경 미리보기를 만들지 못했습니다.",
  );
  process.exitCode = 1;
}
