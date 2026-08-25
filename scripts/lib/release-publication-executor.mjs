import { isAbsolute, resolve } from "node:path";

import {
  createReleasePublicationArtifact,
  ReleasePublicationAuthorizationError,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes,
} from "./release-attestation-file-set.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

function fail(code, message) {
  throw new ReleasePublicationAuthorizationError(code, message);
}

function expectedReceipt(authorization) {
  return {
    registry: authorization.target.registry,
    package: authorization.target.package,
    version: authorization.target.version,
    distTag: authorization.target.distTag,
    registryIntegrity: authorization.artifact.registryIntegrity,
    registryShasum: authorization.artifact.registryShasum,
  };
}

export async function executeAuthorizedReleasePublication(
  { authorization, releaseDirectory },
  { publish },
) {
  validateReleasePublicationAuthorization(authorization);
  if (!isAbsolute(releaseDirectory) || typeof publish !== "function") {
    fail(
      "release_publication_execution_input_invalid",
      "The release publication execution input is invalid.",
    );
  }
  const tarballPath = resolve(releaseDirectory, authorization.artifact.file);
  const tarballContents = await readRegularReleaseFile(
    tarballPath,
    releaseVerificationMaximumSizes.tarball,
  );
  const actualArtifact = createReleasePublicationArtifact(
    authorization.artifact.file,
    authorization.target.version,
    tarballContents,
  );
  if (canonicalJson(actualArtifact) !== canonicalJson(authorization.artifact)) {
    fail(
      "release_publication_artifact_changed",
      "The release artifact changed from the eligibility document immediately before publication.",
    );
  }
  const receipt = await publish({
    target: authorization.target,
    artifact: authorization.artifact,
    tarballPath,
  });
  if (canonicalJson(receipt) !== canonicalJson(expectedReceipt(authorization))) {
    fail(
      "release_publication_receipt_invalid",
      "The registry publication result could not be reconciled with the eligibility document.",
    );
  }
  await assertReleaseFilesUnchanged([
    {
      path: tarballPath,
      contents: tarballContents,
      maximumSize: releaseVerificationMaximumSizes.tarball,
    },
  ]);
  return {
    schemaVersion: 1,
    status: "published",
    authorizationDigest: authorization.authorizationDigest,
    receipt,
  };
}
