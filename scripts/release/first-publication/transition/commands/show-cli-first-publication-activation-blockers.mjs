import { inspectCliFirstPublicationActivationBlockers } from "../cli-first-publication-activation-blockers.mjs";
import { formatFirstPublicationActivationBlockerReport } from "../first-publication-activation-blocker-formatter.mjs";
import { FirstPublicationBootstrapError } from "../first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from "../../../lib/release-attestation-consumer.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_activation_blocker_arguments_invalid",
    "The CLI first-publication activation-blocker report command arguments are invalid.",
  );
}

function parseArguments(args) {
  if (args.length === 0) return { json: false };
  if (args.length === 1 && args[0] === "--json") return { json: true };
  failArguments();
}

try {
  const { json } = parseArguments(process.argv.slice(2));
  const report = await inspectCliFirstPublicationActivationBlockers();
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatFirstPublicationActivationBlockerReport(report),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_activation_blocker_failed: CLI first-publication activation blockers could not be determined.",
    );
  process.exitCode = 1;
}
