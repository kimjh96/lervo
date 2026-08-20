import { basename, isAbsolute, resolve } from "node:path";

import { slsaProvenanceType, validateCliReleaseTag } from "./cli-release-attestation.mjs";
import {
  createReleaseSubject,
  cyclonedxPredicateType,
  failReleaseVerification,
  rejectLocalUnsignedStatement,
  sortReleaseSubjects,
  validateDeliveredReleaseSbom,
  validateVerifiedAttestationResults,
} from "./release-attestation-consumer.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes as maximumSizes,
  validateExactReleaseDirectory,
} from "./release-attestation-file-set.mjs";
import {
  createGitHubReleaseTrustPolicy,
  releaseWorkflowPath,
  verifyGitHubAttestation,
} from "./github-attestation-verifier.mjs";
import { validateReleaseArtifactManifest } from "./release-artifact-manifest.mjs";

function parseBundlePreflight(contents) {
  try {
    rejectLocalUnsignedStatement(JSON.parse(contents.toString("utf8")));
  } catch (error) {
    if (error?.code === "release_attestation_unsigned_untrusted") throw error;
  }
}

export async function verifyCliReleaseAttestations(options, dependencies = {}) {
  const verify = dependencies.verifyGitHubAttestation ?? verifyGitHubAttestation;
  if (
    !isAbsolute(options.releaseDirectory) ||
    (options.trustedRootPath !== undefined && !isAbsolute(options.trustedRootPath))
  ) {
    failReleaseVerification(
      "release_attestation_verification_input_invalid",
      "Release attestation 검증 입력이 올바르지 않습니다.",
    );
  }
  const releaseManifestPath = resolve(
    options.releaseDirectory,
    "release-artifact-manifest.json",
  );
  const releaseManifestContents = await readRegularReleaseFile(
    releaseManifestPath,
    maximumSizes.document,
  );
  let releaseManifest;
  try {
    releaseManifest = validateReleaseArtifactManifest(
      JSON.parse(releaseManifestContents.toString("utf8")),
    );
  } catch (error) {
    if (error?.code) throw error;
    failReleaseVerification(
      "release_attestation_release_set_invalid",
      "Release attestation 파일 집합이 올바르지 않습니다.",
    );
  }
  validateCliReleaseTag(releaseManifest.artifact.version, options.tag);
  const tarballName = `lervo-cli-${releaseManifest.artifact.version}.tgz`;
  await validateExactReleaseDirectory(options.releaseDirectory, [
    tarballName,
    "release-artifact-manifest.json",
    "release-sbom.cdx.json",
    "attestations",
  ]);
  const attestationDirectory = resolve(options.releaseDirectory, "attestations");
  await validateExactReleaseDirectory(attestationDirectory, [
    "build-provenance.sigstore.json",
    "sbom.sigstore.json",
  ]);

  const paths = {
    tarball: resolve(options.releaseDirectory, tarballName),
    manifest: releaseManifestPath,
    sbom: resolve(options.releaseDirectory, "release-sbom.cdx.json"),
    provenanceBundle: resolve(attestationDirectory, "build-provenance.sigstore.json"),
    sbomBundle: resolve(attestationDirectory, "sbom.sigstore.json"),
  };
  const [tarballContents, sbomContents, provenanceBundleContents, sbomBundleContents] =
    await Promise.all([
      readRegularReleaseFile(paths.tarball, maximumSizes.tarball),
      readRegularReleaseFile(paths.sbom, maximumSizes.document),
      readRegularReleaseFile(paths.provenanceBundle, maximumSizes.bundle),
      readRegularReleaseFile(paths.sbomBundle, maximumSizes.bundle),
    ]);
  let sbom;
  try {
    sbom = JSON.parse(sbomContents.toString("utf8"));
  } catch {
    failReleaseVerification(
      "release_attestation_release_set_invalid",
      "Release attestation 파일 집합이 올바르지 않습니다.",
    );
  }
  validateDeliveredReleaseSbom(sbom, releaseManifest.artifact.version);
  parseBundlePreflight(provenanceBundleContents);
  parseBundlePreflight(sbomBundleContents);

  const trustedRootContents = options.trustedRootPath === undefined
    ? undefined
    : await readRegularReleaseFile(options.trustedRootPath, maximumSizes.trustedRoot);
  const policy = createGitHubReleaseTrustPolicy(options);
  const subjects = sortReleaseSubjects([
    createReleaseSubject(tarballName, tarballContents),
    createReleaseSubject("release-artifact-manifest.json", releaseManifestContents),
    createReleaseSubject("release-sbom.cdx.json", sbomContents),
  ]);
  const provenanceResults = await verify({
    artifactPath: paths.tarball,
    bundlePath: paths.provenanceBundle,
    predicateType: slsaProvenanceType,
    policy,
    trustedRootPath: options.trustedRootPath,
  });
  const provenance = validateVerifiedAttestationResults(provenanceResults, {
    predicateType: slsaProvenanceType,
    subjects,
  });
  const sbomResults = await verify({
    artifactPath: paths.tarball,
    bundlePath: paths.sbomBundle,
    predicateType: cyclonedxPredicateType,
    policy,
    trustedRootPath: options.trustedRootPath,
  });
  const sbomAttestation = validateVerifiedAttestationResults(sbomResults, {
    predicateType: cyclonedxPredicateType,
    subjects: [subjects.find(({ name }) => name === tarballName)],
    predicate: sbom,
  });
  await assertReleaseFilesUnchanged([
    { path: paths.tarball, contents: tarballContents, maximumSize: maximumSizes.tarball },
    { path: paths.manifest, contents: releaseManifestContents, maximumSize: maximumSizes.document },
    { path: paths.sbom, contents: sbomContents, maximumSize: maximumSizes.document },
    { path: paths.provenanceBundle, contents: provenanceBundleContents, maximumSize: maximumSizes.bundle },
    { path: paths.sbomBundle, contents: sbomBundleContents, maximumSize: maximumSizes.bundle },
    ...(trustedRootContents === undefined ? [] : [{
      path: options.trustedRootPath,
      contents: trustedRootContents,
      maximumSize: maximumSizes.trustedRoot,
    }]),
  ]);
  return {
    schemaVersion: 1,
    status: "verified",
    repository: policy.repository,
    workflow: releaseWorkflowPath,
    tag: policy.tag,
    sourceDigest: policy.sourceDigest,
    subjects,
    attestations: [provenance, sbomAttestation],
  };
}
