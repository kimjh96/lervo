import { inspectCliFirstPublicationExternalEvidence } from
  "./lib/cli-first-publication-external-evidence.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationExternalEvidenceArguments } from
  "./lib/first-publication-external-evidence-cli-arguments.mjs";
import { formatFirstPublicationExternalEvidenceReport } from
  "./lib/first-publication-external-evidence-formatter.mjs";
import { ReleaseArtifactManifestError } from "./lib/release-artifact-manifest.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from
  "./lib/release-publication-authorization.mjs";

try {
  const parsed = parseFirstPublicationExternalEvidenceArguments(process.argv.slice(2));
  const report = await inspectCliFirstPublicationExternalEvidence(parsed.options);
  process.stdout.write(parsed.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatFirstPublicationExternalEvidenceReport(report));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseArtifactManifestError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_external_evidence_unexpected: CLI 최초 게시 외부 요구사항 증거를 확인하지 못했습니다.",
  );
  process.exitCode = 1;
}
