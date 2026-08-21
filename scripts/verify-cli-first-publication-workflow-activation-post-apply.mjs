import { verifyCliFirstPublicationWorkflowActivationPostApply } from
  "./lib/cli-first-publication-workflow-activation-post-apply.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationWorkflowActivationPostApplyArguments } from
  "./lib/first-publication-workflow-activation-post-apply-cli-arguments.mjs";
import { formatFirstPublicationWorkflowActivationPostApplyReport } from
  "./lib/first-publication-workflow-activation-post-apply-formatter.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from
  "./lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationWorkflowActivationPostApplyArguments(
    process.argv.slice(2),
  );
  const report = await verifyCliFirstPublicationWorkflowActivationPostApply(parsed);
  process.stdout.write(parsed.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatFirstPublicationWorkflowActivationPostApplyReport(report));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof TrustedPublisherReadinessError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_workflow_activation_post_apply_unexpected: " +
    "CLI 최초 게시 workflow 활성화 사후 검증을 완료하지 못했습니다.",
  );
  process.exitCode = 1;
}
