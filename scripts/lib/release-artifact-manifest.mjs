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
  const { artifact, archive, bundle, dependencies } = manifest;
  if (
    manifest.schemaVersion !== 4 ||
    artifact?.name !== "@lervo/cli" ||
    typeof artifact.version !== "string" ||
    !semanticVersionPattern.test(artifact.version) ||
    artifact.description !== "로컬 저장소에서 AI 에이전트 실행과 근거를 관리하는 Lervo CLI" ||
    canonicalJson(artifact.keywords) !== canonicalJson([
      "ai-agents",
      "local-first",
      "orchestration",
    ]) ||
    artifact.license !== "UNLICENSED" ||
    artifact.private !== false ||
    artifact.access !== "public" ||
    artifact.type !== "module" ||
    artifact.node !== ">=22.13" ||
    artifact.bin !== "dist/bin.js" ||
    canonicalJson(artifact.files) !== canonicalJson(["README.md", "dist/bin.js"])
  ) {
    fail("release_artifact_identity_invalid", "Release artifact identity가 올바르지 않습니다.");
  }
  if (
    !Array.isArray(manifest.directDependencies) ||
    !isSortedUnique(manifest.directDependencies) ||
    manifest.directDependencies.some((value) =>
      typeof value !== "string" || !/@\d+\.\d+\.\d+$/.test(value)
    ) ||
    canonicalJson(manifest.directDependencies.map((value) =>
      value.slice(0, value.lastIndexOf("@"))
    )) !== canonicalJson([
      "@anthropic-ai/claude-agent-sdk",
      "@anthropic-ai/sdk",
      "@modelcontextprotocol/sdk",
      "zod",
    ])
  ) {
    fail("release_artifact_dependencies_invalid", "직접 dependency 좌표가 올바르지 않습니다.");
  }
  const workspacePackagesValid = Array.isArray(bundle?.workspacePackages) &&
    bundle.workspacePackages.length > 0 &&
    isSortedUnique(bundle.workspacePackages) &&
    bundle.workspacePackages.every((value) => /^@lervo\/[a-z0-9-]+@\d+\.\d+\.\d+$/.test(value));
  const bundleFields = {
    entry: bundle?.entry,
    output: bundle?.output,
    workspacePackages: bundle?.workspacePackages,
    externalPackages: bundle?.externalPackages,
    externalImports: bundle?.externalImports,
  };
  if (
    bundle?.entry !== "apps/cli/src/bin.ts" ||
    bundle.output !== "dist/bin.js" ||
    !workspacePackagesValid ||
    canonicalJson(bundle.externalPackages) !== canonicalJson([
      "ajv@8.20.0",
      "fast-deep-equal@3.1.3",
      "fast-uri@3.1.5",
      "json-schema-traverse@1.0.0",
      "yaml@2.9.0",
    ]) ||
    canonicalJson(bundle.externalImports) !== canonicalJson(["@anthropic-ai/claude-agent-sdk"]) ||
    bundle.bundleDigest !== canonicalDigest(bundleFields)
  ) {
    fail("release_artifact_bundle_invalid", "CLI bundle 경계가 올바르지 않습니다.");
  }
  const archiveFilesValid = Array.isArray(archive?.files) &&
    archive.files.length === 2 &&
    archive.files.every((entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.path === "string" &&
      (entry.path === "README.md" || entry.path === "dist/bin.js") &&
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
    canonicalJson(archive.files.map((entry) => entry.path)) !==
      canonicalJson(["README.md", "dist/bin.js"]) ||
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
    dependencies.portable.some((value) => value.startsWith("@lervo/")) ||
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
    bundleDigest: bundle.bundleDigest,
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
    "bundle",
    "archive",
    "dependencies",
    "artifactDigest",
  ]) {
    if (canonicalJson(expected[field]) !== canonicalJson(actual[field])) differences.push(field);
  }
  return differences;
}
