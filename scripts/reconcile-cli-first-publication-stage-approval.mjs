import { reconcileCliFirstPublicationStageApproval } from
  "./lib/cli-first-publication-stage-approval-reconciliation.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationStageApprovalReconciliationArguments } from
  "./lib/first-publication-stage-approval-reconciliation-cli-arguments.mjs";
import { formatFirstPublicationStageApprovalReconciliation } from
  "./lib/first-publication-stage-approval-reconciliation-formatter.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from
  "./lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationStageApprovalReconciliationArguments(
    process.argv.slice(2),
  );
  const report = await reconcileCliFirstPublicationStageApproval(parsed);
  process.stdout.write(parsed.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatFirstPublicationStageApprovalReconciliation(report));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof TrustedPublisherReadinessError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_stage_approval_reconciliation_unexpected: " +
    "CLI npm stage 승인 결과를 대조하지 못했습니다.",
  );
  process.exitCode = 1;
}
