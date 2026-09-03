import { isAbsolute } from "node:path";

import { stageCliReleasePublication } from "../lib/cli-release-stage-publication.mjs";
import { ReleaseArtifactManifestError } from "../../shared/release-artifact-manifest.mjs";
import { ReleaseAttestationVerificationError } from "../lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from "../lib/release-publication-authorization.mjs";

function failArguments() {
  throw new ReleasePublicationAuthorizationError(
    "release_stage_publication_arguments_invalid",
    "The CLI stage-publication command arguments are invalid.",
  );
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (
      !["--release-directory", "--publication-authorization", "--result-directory"].includes(
        name,
      ) ||
      values.has(name) ||
      index + 1 >= args.length
    )
      failArguments();
    values.set(name, args[index + 1]);
    index += 1;
  }
  if (values.size !== 3 || [...values.values()].some((value) => !isAbsolute(value)))
    failArguments();
  return {
    releaseDirectory: values.get("--release-directory"),
    publicationAuthorizationPath: values.get("--publication-authorization"),
    resultDirectory: values.get("--result-directory"),
  };
}

try {
  const terminal = await stageCliReleasePublication(parseArguments(process.argv.slice(2)));
  console.log(
    `CLI package stage accepted (${terminal.receipt.target.package}@` +
      `${terminal.receipt.target.version}, 2FA review required before public release)`,
  );
} catch (error) {
  if (
    error instanceof ReleasePublicationAuthorizationError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleaseArtifactManifestError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "release_stage_publication_failed: CLI package stage publication could not be completed.",
    );
  process.exitCode = 1;
}
