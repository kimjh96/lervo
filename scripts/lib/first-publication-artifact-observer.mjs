import { isAbsolute, resolve } from "node:path";

import {
  createReleasePublicationArtifact,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";
import {
  readRegularReleaseFile,
  releaseVerificationMaximumSizes,
} from "./release-attestation-file-set.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

export async function observeFirstPublicationArtifact({
  publicationAuthorization,
  releaseDirectory,
}) {
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  if (typeof releaseDirectory !== "string" || !isAbsolute(releaseDirectory)) {
    throw new TypeError("first-publication artifact observation input is invalid");
  }
  let contents;
  try {
    contents = await readRegularReleaseFile(
      resolve(releaseDirectory, authorization.artifact.file),
      releaseVerificationMaximumSizes.tarball,
    );
  } catch {
    return {
      schemaVersion: 1,
      source: "first_publication_artifact",
      state: "unavailable",
      reason: "artifact_unavailable",
    };
  }
  return createFirstPublicationArtifactObservation(authorization, contents);
}

export function createFirstPublicationArtifactObservation(publicationAuthorization, contents) {
  const authorization = validateReleasePublicationAuthorization(publicationAuthorization);
  if (!Buffer.isBuffer(contents)) {
    throw new TypeError("first-publication artifact contents are invalid");
  }
  const artifact = createReleasePublicationArtifact(
    authorization.artifact.file,
    authorization.target.version,
    contents,
  );
  return canonicalJson(artifact) === canonicalJson(authorization.artifact)
    ? {
      schemaVersion: 1,
      source: "first_publication_artifact",
      state: "verified",
      artifactSha256: artifact.sha256,
    }
    : {
      schemaVersion: 1,
      source: "first_publication_artifact",
      state: "changed",
      artifactSha256: artifact.sha256,
    };
}
