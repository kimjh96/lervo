import { createCliFirstPublicationStageReviewEvidence } from "../cli-first-publication-stage-review.mjs";
import { FirstPublicationBootstrapError } from "../../transition/first-publication-bootstrap.mjs";
import { parseFirstPublicationStageReviewArguments } from "../first-publication-stage-review-cli-arguments.mjs";
import { formatFirstPublicationStageReviewEvidence } from "../first-publication-stage-review-formatter.mjs";
import { ReleaseAttestationVerificationError } from "../../../lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from "../../../lib/release-publication-authorization.mjs";
import { TrustedPublisherReadinessError } from "../../../lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationStageReviewArguments(process.argv.slice(2));
  const report = await createCliFirstPublicationStageReviewEvidence(parsed);
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatFirstPublicationStageReviewEvidence(report),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError ||
    error instanceof TrustedPublisherReadinessError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_stage_review_unexpected: " +
        "CLI npm staged-package review evidence could not be created.",
    );
  process.exitCode = 1;
}
