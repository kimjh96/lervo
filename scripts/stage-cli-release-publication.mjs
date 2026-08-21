import { isAbsolute } from "node:path";

import { stageCliReleasePublication } from "./lib/cli-release-stage-publication.mjs";
import { ReleaseArtifactManifestError } from "./lib/release-artifact-manifest.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from
  "./lib/release-publication-authorization.mjs";

function failArguments() {
  throw new ReleasePublicationAuthorizationError(
    "release_stage_publication_arguments_invalid",
    "CLI stage 게시 명령 인자가 올바르지 않습니다.",
  );
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (
      !["--release-directory", "--publication-authorization", "--result-directory"]
        .includes(name) || values.has(name) || index + 1 >= args.length
    ) failArguments();
    values.set(name, args[index + 1]);
    index += 1;
  }
  if (
    values.size !== 3 ||
    [...values.values()].some((value) => !isAbsolute(value))
  ) failArguments();
  return {
    releaseDirectory: values.get("--release-directory"),
    publicationAuthorizationPath: values.get("--publication-authorization"),
    resultDirectory: values.get("--result-directory"),
  };
}

try {
  const terminal = await stageCliReleasePublication(parseArguments(process.argv.slice(2)));
  console.log(
    `CLI package stage 접수 완료 (${terminal.receipt.target.package}@` +
    `${terminal.receipt.target.version}, 공개 전 2FA 검토 필요)`,
  );
} catch (error) {
  if (
    error instanceof ReleasePublicationAuthorizationError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleaseArtifactManifestError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "release_stage_publication_failed: CLI package stage 게시를 완료하지 못했습니다.",
  );
  process.exitCode = 1;
}
