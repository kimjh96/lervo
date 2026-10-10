import { cliNativeFiles, cliReleaseFilesForSchema } from "./cli-release-files.mjs";
import { createHash } from "node:crypto";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const semanticVersionPattern = /^\d+\.\d+\.\d+$/;
const repositoryPattern = /^git\+https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/u;
const npmPublicRegistry = "https://registry.npmjs.org/";
const supportedCliDescriptions = new Set([
  "Lervo CLI for managing AI agent execution and evidence in local repositories",
]);

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

export function releaseArtifactDigest({
  artifact,
  directDependencies,
  bundle,
  archive,
  dependencies,
}) {
  return canonicalDigest({
    artifact,
    directDependencies,
    bundleDigest: bundle.bundleDigest,
    archiveContentDigest: archive.contentDigest,
    portableDependenciesDigest: dependencies.portableDigest,
    platformSpecificFamilies: dependencies.platformSpecificFamilies,
  });
}

function isSortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function fail(code, message) {
  throw new ReleaseArtifactManifestError(code, message);
}

export function validateReleaseArtifactManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(
      "release_artifact_manifest_invalid",
      "The release artifact manifest structure is invalid.",
    );
  }
  const { artifact, archive, bundle, dependencies } = manifest;
  const expectedFiles = cliReleaseFilesForSchema(manifest.schemaVersion);
  if (
    ![5, 6].includes(manifest.schemaVersion) ||
    artifact?.name !== "@lervo/cli" ||
    typeof artifact.version !== "string" ||
    !semanticVersionPattern.test(artifact.version) ||
    !supportedCliDescriptions.has(artifact.description) ||
    canonicalJson(artifact.keywords) !==
      canonicalJson(["ai-agents", "local-first", "orchestration"]) ||
    typeof artifact.license !== "string" ||
    artifact.license.length < 1 ||
    artifact.license.length > 128 ||
    (artifact.repository !== null &&
      (!repositoryPattern.test(artifact.repository) || artifact.repository.includes(".."))) ||
    (artifact.registry !== null && artifact.registry !== npmPublicRegistry) ||
    (artifact.provenance !== null && artifact.provenance !== true) ||
    artifact.private !== false ||
    artifact.access !== "public" ||
    artifact.type !== "module" ||
    artifact.node !== ">=22.13" ||
    artifact.bin !== "dist/bin.js" ||
    canonicalJson(artifact.files) !== canonicalJson(expectedFiles)
  ) {
    fail("release_artifact_identity_invalid", "The release artifact identity is invalid.");
  }
  if (
    !Array.isArray(manifest.directDependencies) ||
    !isSortedUnique(manifest.directDependencies) ||
    manifest.directDependencies.some(
      (value) => typeof value !== "string" || !/@\d+\.\d+\.\d+$/.test(value),
    ) ||
    canonicalJson(
      manifest.directDependencies.map((value) => value.slice(0, value.lastIndexOf("@"))),
    ) !==
      canonicalJson([
        "@anthropic-ai/claude-agent-sdk",
        "@anthropic-ai/sdk",
        "@modelcontextprotocol/sdk",
        "zod",
      ])
  ) {
    fail("release_artifact_dependencies_invalid", "The direct dependency coordinates are invalid.");
  }
  const workspacePackagesValid =
    Array.isArray(bundle?.workspacePackages) &&
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
    canonicalJson(bundle.externalPackages) !==
      canonicalJson([
        "@babel/parser@7.29.8",
        "ajv@8.20.0",
        "character-entities@2.0.2",
        "decode-named-character-reference@1.3.0",
        "fast-deep-equal@3.1.3",
        "jsonc-parser@3.3.1",
        "mdast-util-from-markdown@2.0.3",
        "mdast-util-to-string@4.0.0",
        "micromark-core-commonmark@2.0.3",
        "micromark-factory-destination@2.0.1",
        "micromark-factory-label@2.0.1",
        "micromark-factory-space@2.0.1",
        "micromark-factory-title@2.0.1",
        "micromark-factory-whitespace@2.0.1",
        "micromark-util-character@2.1.1",
        "micromark-util-chunked@2.0.1",
        "micromark-util-classify-character@2.0.1",
        "micromark-util-combine-extensions@2.0.1",
        "micromark-util-decode-numeric-character-reference@2.0.2",
        "micromark-util-decode-string@2.0.1",
        "micromark-util-encode@2.0.1",
        "micromark-util-html-tag-name@2.0.1",
        "micromark-util-normalize-identifier@2.0.1",
        "micromark-util-resolve-all@2.0.1",
        "micromark-util-sanitize-uri@2.0.1",
        "micromark-util-subtokenize@2.1.0",
        "micromark@4.0.2",
        "nanoid@3.3.18",
        "picocolors@1.1.1",
        "postcss@8.5.26",
        "source-map-js@1.2.1",
        "unist-util-stringify-position@4.0.0",
        "yaml@2.9.0",
      ]) ||
    canonicalJson(bundle.externalImports) !== canonicalJson(["@anthropic-ai/claude-agent-sdk"]) ||
    bundle.bundleDigest !== canonicalDigest(bundleFields)
  ) {
    fail("release_artifact_bundle_invalid", "The CLI bundle boundary is invalid.");
  }
  const archiveFilesValid =
    Array.isArray(archive?.files) &&
    archive.files.length === expectedFiles.length &&
    archive.files.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.path === "string" &&
        expectedFiles.includes(entry.path) &&
        Number.isSafeInteger(entry.size) &&
        entry.size >= 0 &&
        (!cliNativeFiles.includes(entry.path) ||
          (entry.size > 0 && entry.size <= (entry.path.endsWith(".node") ? 1048576 : 4096))) &&
        typeof entry.sha256 === "string" &&
        digestPattern.test(entry.sha256),
    );
  if (
    !Array.isArray(archive?.rootFiles) ||
    archive.rootFiles.length !== 1 ||
    archive.rootFiles[0] !== "package.json" ||
    !archiveFilesValid ||
    canonicalJson(archive.files.map((entry) => entry.path)) !== canonicalJson(expectedFiles) ||
    !isSortedUnique(archive.files.map((entry) => entry.path)) ||
    archive.fileCount !== archive.files.length + archive.rootFiles.length ||
    archive.contentDigest !== canonicalDigest(archive.files)
  ) {
    fail("release_artifact_archive_invalid", "The release archive file contract is invalid.");
  }
  const platformFamiliesValid =
    Array.isArray(dependencies?.platformSpecificFamilies) &&
    dependencies.platformSpecificFamilies.every(
      (family) =>
        family !== null &&
        typeof family === "object" &&
        typeof family.prefix === "string" &&
        family.prefix.length > 0 &&
        typeof family.version === "string" &&
        semanticVersionPattern.test(family.version),
    );
  if (
    !Array.isArray(dependencies?.portable) ||
    dependencies.portable.length === 0 ||
    !isSortedUnique(dependencies.portable) ||
    dependencies.portable.some((value) => typeof value !== "string") ||
    dependencies.portable.some((value) => value.startsWith("@lervo/")) ||
    dependencies.portableDigest !== canonicalDigest(dependencies.portable) ||
    !platformFamiliesValid ||
    !isSortedUnique(
      dependencies.platformSpecificFamilies.map((family) => `${family.prefix}@${family.version}`),
    )
  ) {
    fail("release_artifact_closure_invalid", "The production dependency closure is invalid.");
  }
  const expectedArtifactDigest = releaseArtifactDigest(manifest);
  if (
    !digestPattern.test(manifest.artifactDigest) ||
    manifest.artifactDigest !== expectedArtifactDigest
  ) {
    fail("release_artifact_digest_invalid", "The release artifact digest is invalid.");
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

export function releaseArchiveFileDifferences(expected, actual) {
  const expectedFiles = new Map((expected?.files ?? []).map((entry) => [entry.path, entry]));
  const actualFiles = new Map((actual?.files ?? []).map((entry) => [entry.path, entry]));
  const paths = [...new Set([...expectedFiles.keys(), ...actualFiles.keys()])].sort();
  return paths.flatMap((path) => {
    const expectedEntry = expectedFiles.get(path);
    const actualEntry = actualFiles.get(path);
    if (canonicalJson(expectedEntry) === canonicalJson(actualEntry)) return [];
    return [
      `${path} expected=${expectedEntry?.size ?? "missing"}/${expectedEntry?.sha256 ?? "missing"} ` +
        `actual=${actualEntry?.size ?? "missing"}/${actualEntry?.sha256 ?? "missing"}`,
    ];
  });
}
