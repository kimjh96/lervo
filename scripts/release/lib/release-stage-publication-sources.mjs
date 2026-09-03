import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { validateDeliveredReleaseSbom } from "./release-attestation-consumer.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes as maximumSizes,
  validateExactReleaseDirectory,
} from "./release-attestation-file-set.mjs";
import {
  canonicalJson,
  validateReleaseArtifactManifest,
} from "../../shared/release-artifact-manifest.mjs";
import {
  createReleasePublicationArtifact,
  ReleasePublicationAuthorizationError,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";

const maximumAuthorizationBytes = 64 * 1024;

function fail(code = "release_stage_publication_source_invalid") {
  throw new ReleasePublicationAuthorizationError(
    code,
    "The CLI stage-publication source is invalid.",
  );
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function parseJson(contents) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
}

export async function readReleaseStagePublicationSources({
  releaseDirectory,
  publicationAuthorizationPath,
}) {
  if (!isAbsolute(releaseDirectory ?? "") || !isAbsolute(publicationAuthorizationPath ?? ""))
    fail("release_stage_publication_source_input_invalid");
  const authorizationContents = await readRegularReleaseFile(
    publicationAuthorizationPath,
    maximumAuthorizationBytes,
  );
  let authorization;
  try {
    authorization = validateReleasePublicationAuthorization(parseJson(authorizationContents));
  } catch (error) {
    if (error instanceof ReleasePublicationAuthorizationError) throw error;
    fail();
  }
  const tarballName = authorization.artifact.file;
  await validateExactReleaseDirectory(releaseDirectory, [
    tarballName,
    "release-artifact-manifest.json",
    "release-sbom.cdx.json",
    "attestations",
  ]);
  const attestationDirectory = resolve(releaseDirectory, "attestations");
  await validateExactReleaseDirectory(attestationDirectory, [
    "build-provenance.sigstore.json",
    "sbom.sigstore.json",
  ]);
  const paths = {
    authorization: publicationAuthorizationPath,
    tarball: resolve(releaseDirectory, tarballName),
    manifest: resolve(releaseDirectory, "release-artifact-manifest.json"),
    sbom: resolve(releaseDirectory, "release-sbom.cdx.json"),
    provenanceBundle: resolve(attestationDirectory, "build-provenance.sigstore.json"),
    sbomBundle: resolve(attestationDirectory, "sbom.sigstore.json"),
  };
  const [tarballContents, manifestContents, sbomContents, provenanceContents, sbomBundleContents] =
    await Promise.all([
      readRegularReleaseFile(paths.tarball, maximumSizes.tarball),
      readRegularReleaseFile(paths.manifest, maximumSizes.document),
      readRegularReleaseFile(paths.sbom, maximumSizes.document),
      readRegularReleaseFile(paths.provenanceBundle, maximumSizes.bundle),
      readRegularReleaseFile(paths.sbomBundle, maximumSizes.bundle),
    ]);
  let manifest;
  try {
    manifest = validateReleaseArtifactManifest(parseJson(manifestContents));
    validateDeliveredReleaseSbom(parseJson(sbomContents), authorization.target.version);
  } catch (error) {
    if (error?.code) throw error;
    fail();
  }
  const actualArtifact = createReleasePublicationArtifact(
    tarballName,
    authorization.target.version,
    tarballContents,
  );
  const expectedSubjects = new Map(
    authorization.release.subjects.map(({ name, digest }) => [name, digest.sha256]),
  );
  if (
    manifest.artifact.name !== authorization.target.package ||
    manifest.artifact.version !== authorization.target.version ||
    canonicalJson(actualArtifact) !== canonicalJson(authorization.artifact) ||
    expectedSubjects.get(tarballName) !== sha256(tarballContents) ||
    expectedSubjects.get("release-artifact-manifest.json") !== sha256(manifestContents) ||
    expectedSubjects.get("release-sbom.cdx.json") !== sha256(sbomContents)
  )
    fail("release_stage_publication_source_mismatch");
  const snapshots = [
    {
      path: paths.authorization,
      contents: authorizationContents,
      maximumSize: maximumAuthorizationBytes,
    },
    { path: paths.tarball, contents: tarballContents, maximumSize: maximumSizes.tarball },
    { path: paths.manifest, contents: manifestContents, maximumSize: maximumSizes.document },
    { path: paths.sbom, contents: sbomContents, maximumSize: maximumSizes.document },
    {
      path: paths.provenanceBundle,
      contents: provenanceContents,
      maximumSize: maximumSizes.bundle,
    },
    { path: paths.sbomBundle, contents: sbomBundleContents, maximumSize: maximumSizes.bundle },
  ];
  return {
    authorization,
    releaseDirectory,
    tarballPath: paths.tarball,
    assertUnchanged: () => assertReleaseFilesUnchanged(snapshots),
  };
}
