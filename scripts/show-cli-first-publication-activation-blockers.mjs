import { inspectCliFirstPublicationActivationBlockers } from
  "./lib/cli-first-publication-activation-blockers.mjs";
import { formatFirstPublicationActivationBlockerReport } from
  "./lib/first-publication-activation-blocker-formatter.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_activation_blocker_arguments_invalid",
    "CLI 최초 게시 활성화 차단 보고서 명령 인자가 올바르지 않습니다.",
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
  process.stdout.write(json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatFirstPublicationActivationBlockerReport(report));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_activation_blocker_failed: CLI 최초 게시 활성화 차단 항목을 확인하지 못했습니다.",
  );
  process.exitCode = 1;
}
