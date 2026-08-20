import { isAbsolute } from "node:path";

import {
  authorizeCliReleasePublication,
  writeReleasePublicationAuthorization,
} from "./lib/cli-release-publication-authorization.mjs";
import { ReleaseAttestationVerificationError } from "./lib/release-attestation-consumer.mjs";
import { ReleaseAttestationError } from "./lib/cli-release-attestation.mjs";
import { ReleaseArtifactManifestError } from "./lib/release-artifact-manifest.mjs";
import { ReleasePublicationAuthorizationError } from "./lib/release-publication-authorization.mjs";

function failArguments() {
  throw new ReleasePublicationAuthorizationError(
    "release_publication_arguments_invalid",
    "Release 게시 적격성 명령 인자가 올바르지 않습니다.",
  );
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (![
      "--release-directory",
      "--repository",
      "--tag",
      "--source-digest",
      "--dist-tag",
      "--output",
      "--trusted-root",
    ].includes(name) || values.has(name) || index + 1 >= args.length) {
      failArguments();
    }
    values.set(name, args[index + 1]);
    index += 1;
  }
  for (const name of [
    "--release-directory",
    "--repository",
    "--tag",
    "--source-digest",
    "--dist-tag",
    "--output",
  ]) {
    if (!values.has(name)) failArguments();
  }
  const outputPath = values.get("--output");
  if (!isAbsolute(outputPath)) failArguments();
  return {
    options: {
      releaseDirectory: values.get("--release-directory"),
      repository: values.get("--repository"),
      tag: values.get("--tag"),
      sourceDigest: values.get("--source-digest"),
      distTag: values.get("--dist-tag"),
      trustedRootPath: values.get("--trusted-root"),
    },
    outputPath,
  };
}

try {
  const { options, outputPath } = parseArguments(process.argv.slice(2));
  const authorization = await authorizeCliReleasePublication(options);
  await writeReleasePublicationAuthorization(outputPath, authorization);
  console.log(`CLI release 게시 적격성 검사 통과 (${authorization.target.package}@${authorization.target.version}, ${authorization.target.distTag})`);
} catch (error) {
  if (
    error instanceof ReleasePublicationAuthorizationError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleaseAttestationError ||
    error instanceof ReleaseArtifactManifestError
  ) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error("release_publication_authorization_failed: Release 게시 적격성 검사를 완료하지 못했습니다.");
  }
  process.exitCode = 1;
}
