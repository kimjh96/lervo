import { createHash } from "node:crypto";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const semanticVersionPattern = /^\d+\.\d+\.\d+$/;

export class ReleaseArtifactManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseArtifactManifestError";
    this.code = code;
  }
}

export function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalDigest(value) {
  return sha256(canonicalJson(value));
}

function isSortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function fail(code, message) {
  throw new ReleaseArtifactManifestError(code, message);
}

export function validateReleaseArtifactManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("release_artifact_manifest_invalid", "Release artifact manifest 구조가 올바르지 않습니다.");
  }
  const { artifact, archive, dependencies } = manifest;
  if (
    manifest.schemaVersion !== 1 ||
    artifact?.name !== "@lervo/cli" ||
    typeof artifact.version !== "string" ||
    !semanticVersionPattern.test(artifact.version) ||
    artifact.private !== true ||
    artifact.type !== "module" ||
    artifact.bin !== "dist/bin.js" ||
    artifact.main !== "dist/main.js" ||
    artifact.types !== "dist/main.d.ts" ||
    canonicalJson(artifact.files) !== canonicalJson(["dist/**/*.js", "dist/**/*.d.ts"])
  ) {
    fail("release_artifact_identity_invalid", "Release artifact identity가 올바르지 않습니다.");
  }
  if (
    !Array.isArray(manifest.directDependencies) ||
    !isSortedUnique(manifest.directDependencies) ||
    manifest.directDependencies.some((value) => typeof value !== "string")
  ) {
    fail("release_artifact_dependencies_invalid", "직접 dependency 좌표가 올바르지 않습니다.");
  }
  const archiveFilesValid = Array.isArray(archive?.files) &&
    archive.files.length > 0 &&
    archive.files.every((entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.path === "string" &&
      /^dist\/.+\.(?:js|d\.ts)$/.test(entry.path) &&
      Number.isSafeInteger(entry.size) &&
      entry.size >= 0 &&
      typeof entry.sha256 === "string" &&
      digestPattern.test(entry.sha256)
    );
  if (
    !Array.isArray(archive?.rootFiles) ||
    archive.rootFiles.length !== 1 ||
    archive.rootFiles[0] !== "package.json" ||
    !archiveFilesValid ||
    !isSortedUnique(archive.files.map((entry) => entry.path)) ||
    archive.fileCount !== archive.files.length + archive.rootFiles.length ||
    archive.contentDigest !== canonicalDigest(archive.files)
  ) {
    fail("release_artifact_archive_invalid", "Release archive 파일 계약이 올바르지 않습니다.");
  }
  const platformFamiliesValid = Array.isArray(dependencies?.platformSpecificFamilies) &&
    dependencies.platformSpecificFamilies.every((family) =>
      family !== null &&
      typeof family === "object" &&
      typeof family.prefix === "string" &&
      family.prefix.length > 0 &&
      typeof family.version === "string" &&
      semanticVersionPattern.test(family.version)
    );
  if (
    !Array.isArray(dependencies?.portable) ||
    dependencies.portable.length === 0 ||
    !isSortedUnique(dependencies.portable) ||
    dependencies.portable.some((value) => typeof value !== "string") ||
    dependencies.portableDigest !== canonicalDigest(dependencies.portable) ||
    !platformFamiliesValid ||
    !isSortedUnique(dependencies.platformSpecificFamilies.map((family) =>
      `${family.prefix}@${family.version}`
    ))
  ) {
    fail("release_artifact_closure_invalid", "Production dependency closure가 올바르지 않습니다.");
  }
  const expectedArtifactDigest = canonicalDigest({
    artifact,
    directDependencies: manifest.directDependencies,
    archiveContentDigest: archive.contentDigest,
    portableDependenciesDigest: dependencies.portableDigest,
    platformSpecificFamilies: dependencies.platformSpecificFamilies,
  });
  if (!digestPattern.test(manifest.artifactDigest) || manifest.artifactDigest !== expectedArtifactDigest) {
    fail("release_artifact_digest_invalid", "Release artifact digest가 올바르지 않습니다.");
  }
  return manifest;
}

export function releaseArtifactDifferences(expected, actual) {
  const differences = [];
  for (const field of [
    "artifact",
    "directDependencies",
    "archive",
    "dependencies",
    "artifactDigest",
  ]) {
    if (canonicalJson(expected[field]) !== canonicalJson(actual[field])) differences.push(field);
  }
  return differences;
}
