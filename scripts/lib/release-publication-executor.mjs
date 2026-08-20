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
      "Release 게시 실행 입력이 올바르지 않습니다.",
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
      "게시 직전 release artifact가 적격성 문서와 달라졌습니다.",
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
      "Registry 게시 결과를 적격성 문서와 대조하지 못했습니다.",
    );
  }
  await assertReleaseFilesUnchanged([{
    path: tarballPath,
    contents: tarballContents,
    maximumSize: releaseVerificationMaximumSizes.tarball,
  }]);
  return {
    schemaVersion: 1,
    status: "published",
    authorizationDigest: authorization.authorizationDigest,
    receipt,
  };
}
