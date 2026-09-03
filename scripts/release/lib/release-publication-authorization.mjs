import { createHash } from "node:crypto";

import { canonicalDigest, canonicalJson } from "../../shared/release-artifact-manifest.mjs";

const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const sourceDigestPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const repositoryPattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/u;

export const npmPublicRegistry = "https://registry.npmjs.org/";
export const cliPublicationDistTags = ["latest", "next"];

export class ReleasePublicationAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleasePublicationAuthorizationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleasePublicationAuthorizationError(code, message);
}

function digest(algorithm, contents, encoding = "hex") {
  return createHash(algorithm).update(contents).digest(encoding);
}

function authorizationBody(authorization) {
  return {
    schemaVersion: authorization.schemaVersion,
    status: authorization.status,
    target: authorization.target,
    artifact: authorization.artifact,
    release: authorization.release,
  };
}

function validateReleaseEvidence(release, artifact) {
  if (
    release === null ||
    typeof release !== "object" ||
    !repositoryPattern.test(release.repository ?? "") ||
    release.repository.includes("..") ||
    release.workflow !== ".github/workflows/cli-release-matrix.yml" ||
    release.tag !== `v${artifact.version}` ||
    !sourceDigestPattern.test(release.sourceDigest ?? "") ||
    !Array.isArray(release.subjects) ||
    release.subjects.length !== 3
  ) {
    fail(
      "release_publication_authorization_invalid",
      "The release publication eligibility document is invalid.",
    );
  }
  const expectedNames = [
    artifact.file,
    "release-artifact-manifest.json",
    "release-sbom.cdx.json",
  ].sort();
  const names = release.subjects.map(({ name }) => name).sort();
  if (
    canonicalJson(names) !== canonicalJson(expectedNames) ||
    release.subjects.some(
      (subject) =>
        subject === null ||
        typeof subject !== "object" ||
        typeof subject.name !== "string" ||
        subject.digest === null ||
        typeof subject.digest !== "object" ||
        Object.keys(subject.digest).length !== 1 ||
        !sha256Pattern.test(subject.digest.sha256 ?? ""),
    )
  ) {
    fail(
      "release_publication_authorization_invalid",
      "The release publication eligibility document is invalid.",
    );
  }
  const tarballSubject = release.subjects.find(({ name }) => name === artifact.file);
  if (tarballSubject.digest.sha256 !== artifact.sha256) {
    fail(
      "release_publication_authorization_invalid",
      "The release publication eligibility document is invalid.",
    );
  }
}

export function createReleasePublicationArtifact(file, version, contents) {
  if (
    !Buffer.isBuffer(contents) ||
    contents.length === 0 ||
    file !== `lervo-cli-${version}.tgz` ||
    !/^\d+\.\d+\.\d+$/u.test(version)
  ) {
    fail(
      "release_publication_input_invalid",
      "The release publication eligibility input is invalid.",
    );
  }
  return {
    file,
    sha256: digest("sha256", contents),
    registryIntegrity: `sha512-${digest("sha512", contents, "base64")}`,
    registryShasum: digest("sha1", contents),
  };
}

export function createReleasePublicationAuthorization({
  verification,
  version,
  distTag,
  artifact,
  registry = npmPublicRegistry,
}) {
  if (
    verification?.schemaVersion !== 1 ||
    verification.status !== "verified" ||
    !cliPublicationDistTags.includes(distTag) ||
    registry !== npmPublicRegistry ||
    artifact?.file !== `lervo-cli-${version}.tgz` ||
    !sha256Pattern.test(artifact.sha256 ?? "") ||
    !sha512IntegrityPattern.test(artifact.registryIntegrity ?? "") ||
    !sha1Pattern.test(artifact.registryShasum ?? "")
  ) {
    fail(
      "release_publication_input_invalid",
      "The release publication eligibility input is invalid.",
    );
  }
  const body = {
    schemaVersion: 1,
    status: "eligible",
    target: {
      registry,
      package: "@lervo/cli",
      version,
      distTag,
      access: "public",
    },
    artifact,
    release: {
      repository: verification.repository,
      workflow: verification.workflow,
      tag: verification.tag,
      sourceDigest: verification.sourceDigest,
      subjects: verification.subjects,
    },
  };
  validateReleaseEvidence(body.release, { ...artifact, version });
  return { ...body, authorizationDigest: canonicalDigest(body) };
}

export function validateReleasePublicationAuthorization(authorization) {
  if (
    authorization === null ||
    typeof authorization !== "object" ||
    Array.isArray(authorization) ||
    authorization.schemaVersion !== 1 ||
    authorization.status !== "eligible" ||
    authorization.target?.registry !== npmPublicRegistry ||
    authorization.target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(authorization.target.version ?? "") ||
    !cliPublicationDistTags.includes(authorization.target.distTag) ||
    authorization.target.access !== "public" ||
    authorization.artifact?.file !== `lervo-cli-${authorization.target.version}.tgz` ||
    !sha256Pattern.test(authorization.artifact.sha256 ?? "") ||
    !sha512IntegrityPattern.test(authorization.artifact.registryIntegrity ?? "") ||
    !sha1Pattern.test(authorization.artifact.registryShasum ?? "") ||
    authorization.authorizationDigest !== canonicalDigest(authorizationBody(authorization))
  ) {
    fail(
      "release_publication_authorization_invalid",
      "The release publication eligibility document is invalid.",
    );
  }
  validateReleaseEvidence(authorization.release, {
    ...authorization.artifact,
    version: authorization.target.version,
  });
  return authorization;
}
