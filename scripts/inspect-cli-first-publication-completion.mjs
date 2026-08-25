import { inspectCliFirstPublicationCompletion } from "./lib/cli-first-publication-completion-inspection.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { parseFirstPublicationCompletionInspectionArguments } from "./lib/first-publication-completion-inspection-cli-arguments.mjs";
import { formatFirstPublicationCompletionInspection } from "./lib/first-publication-completion-inspection-formatter.mjs";
import { ReleaseAttestationVerificationError } from "./lib/release-attestation-consumer.mjs";

try {
  const input = parseFirstPublicationCompletionInspectionArguments(process.argv.slice(2));
  const report = await inspectCliFirstPublicationCompletion(input);
  process.stdout.write(
    input.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatFirstPublicationCompletionInspection(report),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_completion_inspection_unexpected: " +
        "CLI first-publication completion status could not be inspected.",
    );
  process.exitCode = 1;
}
