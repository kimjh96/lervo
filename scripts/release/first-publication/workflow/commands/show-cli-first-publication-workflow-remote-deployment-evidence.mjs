import { createCliFirstPublicationWorkflowRemoteDeploymentEvidence } from "../cli-first-publication-workflow-remote-deployment.mjs";
import { FirstPublicationBootstrapError } from "../../transition/first-publication-bootstrap.mjs";
import { parseFirstPublicationWorkflowRemoteDeploymentArguments } from "../first-publication-workflow-remote-deployment-cli-arguments.mjs";
import { formatFirstPublicationWorkflowRemoteDeploymentEvidence } from "../first-publication-workflow-remote-deployment-formatter.mjs";
import { ReleaseAttestationVerificationError } from "../../../lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from "../../../lib/trusted-publisher-readiness.mjs";

try {
  const parsed = parseFirstPublicationWorkflowRemoteDeploymentArguments(process.argv.slice(2));
  const evidence = await createCliFirstPublicationWorkflowRemoteDeploymentEvidence(parsed);
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(evidence, null, 2)}\n`
      : formatFirstPublicationWorkflowRemoteDeploymentEvidence(evidence),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof TrustedPublisherReadinessError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_workflow_remote_deployment_unexpected: " +
        "CLI stage-only workflow remote-deployment evidence could not be created.",
    );
  process.exitCode = 1;
}
