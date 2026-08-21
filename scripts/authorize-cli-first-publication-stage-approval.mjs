import { authorizeCliFirstPublicationStageApproval } from
  "./lib/cli-first-publication-stage-approval.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationStageApprovalArguments } from
  "./lib/first-publication-stage-approval-cli-arguments.mjs";
import { formatFirstPublicationStageApprovalAuthorization } from
  "./lib/first-publication-stage-approval-formatter.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from
  "./lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationStageApprovalArguments(process.argv.slice(2));
  const authorization = await authorizeCliFirstPublicationStageApproval(parsed);
  process.stdout.write(parsed.json
    ? `${JSON.stringify(authorization, null, 2)}\n`
    : formatFirstPublicationStageApprovalAuthorization(authorization));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof TrustedPublisherReadinessError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_stage_approval_unexpected: " +
    "CLI npm stage 승인 권한을 만들지 못했습니다.",
  );
  process.exitCode = 1;
}
