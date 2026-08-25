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
    "The release publication eligibility command arguments are invalid.",
  );
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (
      ![
        "--release-directory",
        "--repository",
        "--tag",
        "--source-digest",
        "--dist-tag",
        "--output",
        "--trusted-root",
      ].includes(name) ||
      values.has(name) ||
      index + 1 >= args.length
    ) {
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
  console.log(
    `CLI release publication eligibility check passed (${authorization.target.package}@${authorization.target.version}, ${authorization.target.distTag})`,
  );
} catch (error) {
  if (
    error instanceof ReleasePublicationAuthorizationError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleaseAttestationError ||
    error instanceof ReleaseArtifactManifestError
  ) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(
      "release_publication_authorization_failed: The release publication eligibility check could not be completed.",
    );
  }
  process.exitCode = 1;
}
