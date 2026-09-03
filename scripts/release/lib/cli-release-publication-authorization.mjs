import { writeFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import { verifyCliReleaseAttestations } from "./cli-release-attestation-consumer.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
  ReleasePublicationAuthorizationError,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes,
} from "./release-attestation-file-set.mjs";
import { validateReleaseArtifactManifest } from "../../shared/release-artifact-manifest.mjs";

function failInput() {
  throw new ReleasePublicationAuthorizationError(
    "release_publication_input_invalid",
    "The release publication eligibility input is invalid.",
  );
}

export async function authorizeCliReleasePublication(options, dependencies = {}) {
  if (!isAbsolute(options.releaseDirectory)) failInput();
  const verify = dependencies.verifyCliReleaseAttestations ?? verifyCliReleaseAttestations;
  const verification = await verify({
    releaseDirectory: options.releaseDirectory,
    repository: options.repository,
    tag: options.tag,
    sourceDigest: options.sourceDigest,
    trustedRootPath: options.trustedRootPath,
  });
  const manifestPath = resolve(options.releaseDirectory, "release-artifact-manifest.json");
  const manifestContents = await readRegularReleaseFile(
    manifestPath,
    releaseVerificationMaximumSizes.document,
  );
  let manifest;
  try {
    manifest = validateReleaseArtifactManifest(JSON.parse(manifestContents.toString("utf8")));
  } catch (error) {
    if (error?.code) throw error;
    failInput();
  }
  const tarballPath = resolve(
    options.releaseDirectory,
    `lervo-cli-${manifest.artifact.version}.tgz`,
  );
  const tarballContents = await readRegularReleaseFile(
    tarballPath,
    releaseVerificationMaximumSizes.tarball,
  );
  const artifact = createReleasePublicationArtifact(
    basename(tarballPath),
    manifest.artifact.version,
    tarballContents,
  );
  const authorization = createReleasePublicationAuthorization({
    verification,
    version: manifest.artifact.version,
    distTag: options.distTag,
    artifact,
  });
  await assertReleaseFilesUnchanged([
    {
      path: manifestPath,
      contents: manifestContents,
      maximumSize: releaseVerificationMaximumSizes.document,
    },
    {
      path: tarballPath,
      contents: tarballContents,
      maximumSize: releaseVerificationMaximumSizes.tarball,
    },
  ]);
  return authorization;
}

export async function writeReleasePublicationAuthorization(outputPath, authorization) {
  if (!isAbsolute(outputPath)) failInput();
  validateReleasePublicationAuthorization(authorization);
  await writeFile(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
