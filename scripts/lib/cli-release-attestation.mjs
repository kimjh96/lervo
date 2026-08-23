import { createHash } from "node:crypto";

import { canonicalJson } from "./release-artifact-manifest.mjs";

export const inTotoStatementType = "https://in-toto.io/Statement/v1";
export const slsaProvenanceType = "https://slsa.dev/provenance/v1";
export const localCliBuildType = "urn:lervo:build-type:cli-release:v1";
export const localUnsignedBuilderId = "urn:lervo:builder:local-unsigned:v1";

const sha256Pattern = /^[a-f0-9]{64}$/u;

export class ReleaseAttestationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseAttestationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseAttestationError(code, message);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function descriptor(name, mediaType, contents) {
  return { name, digest: { sha256: sha256(contents) }, mediaType };
}

function sortedDescriptors(descriptors) {
  return descriptors.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );
}

export function validateCliReleaseTag(packageVersion, tag) {
  if (
    typeof packageVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(packageVersion) ||
    typeof tag !== "string" ||
    tag !== `v${packageVersion}`
  ) {
    fail("release_attestation_tag_mismatch", "The release tag does not match the package version.");
  }
  return tag;
}

export function createLocalCliReleaseStatement({
  tarballName,
  tarballContents,
  releaseManifestContents,
  releaseSbomContents,
  packageManifestContents,
  packageReadmeContents,
  bundleContents,
  lockfileContents,
  nodeVersion,
  packageManager,
  platform,
  architecture,
}) {
  if (
    typeof tarballName !== "string" ||
    !/^lervo-cli-\d+\.\d+\.\d+\.tgz$/u.test(tarballName) ||
    !Buffer.isBuffer(tarballContents) ||
    typeof nodeVersion !== "string" ||
    !/^v\d+\.\d+\.\d+$/u.test(nodeVersion) ||
    typeof packageManager !== "string" ||
    !/^pnpm@\d+\.\d+\.\d+$/u.test(packageManager) ||
    typeof platform !== "string" ||
    platform.length === 0 ||
    typeof architecture !== "string" ||
    architecture.length === 0
  ) {
    fail("release_attestation_input_invalid", "The release statement input is invalid.");
  }
  for (const contents of [
    releaseManifestContents,
    releaseSbomContents,
    packageManifestContents,
    packageReadmeContents,
    bundleContents,
    lockfileContents,
  ]) {
    if (!Buffer.isBuffer(contents)) {
      fail("release_attestation_input_invalid", "The release statement input is invalid.");
    }
  }

  const subjects = sortedDescriptors([
    descriptor(tarballName, "application/gzip", tarballContents),
    descriptor("release-artifact-manifest.json", "application/json", releaseManifestContents),
    descriptor(
      "release-sbom.cdx.json",
      "application/vnd.cyclonedx+json; version=1.7",
      releaseSbomContents,
    ),
  ]);
  const resolvedDependencies = sortedDescriptors([
    descriptor("apps/cli/README.md", "text/markdown", packageReadmeContents),
    descriptor("apps/cli/dist/bin.js", "text/javascript", bundleContents),
    descriptor("apps/cli/package.json", "application/json", packageManifestContents),
    descriptor(
      "apps/cli/release-artifact-manifest.json",
      "application/json",
      releaseManifestContents,
    ),
    descriptor(
      "apps/cli/release-sbom.cdx.json",
      "application/vnd.cyclonedx+json; version=1.7",
      releaseSbomContents,
    ),
    descriptor("pnpm-lock.yaml", "application/yaml", lockfileContents),
  ]);

  return {
    _type: inTotoStatementType,
    subject: subjects,
    predicateType: slsaProvenanceType,
    predicate: {
      buildDefinition: {
        buildType: localCliBuildType,
        externalParameters: {},
        internalParameters: {
          architecture,
          nodeVersion,
          packageManager,
          platform,
        },
        resolvedDependencies,
      },
      runDetails: {
        builder: {
          id: localUnsignedBuilderId,
          version: {
            "lervo-release-statement": "1",
            node: nodeVersion.slice(1),
            pnpm: packageManager.slice("pnpm@".length),
          },
        },
      },
    },
  };
}

function descriptorsValid(descriptors) {
  return Array.isArray(descriptors) &&
    descriptors.length > 0 &&
    descriptors.every((item, index) =>
      item !== null &&
      typeof item === "object" &&
      typeof item.name === "string" &&
      item.name.length > 0 &&
      (index === 0 || descriptors[index - 1].name < item.name) &&
      typeof item.mediaType === "string" &&
      item.mediaType.length > 0 &&
      item.digest !== null &&
      typeof item.digest === "object" &&
      Object.keys(item.digest).length === 1 &&
      typeof item.digest.sha256 === "string" &&
      sha256Pattern.test(item.digest.sha256)
    );
}

export function validateLocalCliReleaseStatement(statement, inputs) {
  if (statement === null || typeof statement !== "object" || Array.isArray(statement)) {
    fail("release_attestation_statement_invalid", "The release statement structure is invalid.");
  }
  if (
    Object.hasOwn(statement, "signatures") ||
    Object.hasOwn(statement, "payload") ||
    Object.hasOwn(statement, "payloadType")
  ) {
    fail(
      "release_attestation_envelope_unexpected",
      "A local statement cannot be represented as a signed envelope.",
    );
  }
  if (
    statement._type !== inTotoStatementType ||
    statement.predicateType !== slsaProvenanceType ||
    !descriptorsValid(statement.subject) ||
    !descriptorsValid(statement.predicate?.buildDefinition?.resolvedDependencies) ||
    statement.predicate?.buildDefinition?.buildType !== localCliBuildType ||
    statement.predicate?.runDetails?.builder?.id !== localUnsignedBuilderId ||
    Object.hasOwn(statement.predicate?.runDetails ?? {}, "metadata")
  ) {
    fail("release_attestation_statement_invalid", "The release statement structure is invalid.");
  }
  const expected = createLocalCliReleaseStatement(inputs);
  if (canonicalJson(statement) !== canonicalJson(expected)) {
    fail(
      "release_attestation_statement_mismatch",
      "The release statement does not match the current release files.",
    );
  }
  return statement;
}
