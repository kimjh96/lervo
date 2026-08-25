import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";

import {
  canonicalDigest,
  releaseArtifactDigest,
  ReleaseArtifactManifestError,
  sha256,
} from "./release-artifact-manifest.mjs";
import { collectInstalledPackages, classifyDependencies } from "./release-dependency-closure.mjs";
import { readJson, repositoryRoot, runPnpm } from "./installed-cli.mjs";

const cliRoot = resolve(repositoryRoot, "apps/cli");
const cliManifestPath = resolve(cliRoot, "package.json");
const bundleMetafilePath = resolve(cliRoot, "dist/bin.metafile.json");
const bundleOutputPath = "apps/cli/dist/bin.js";
const publicContentPaths = new Set([
  "README.md",
  "dist/bin.js",
  "dist/node-runtime.js",
  "dist/terminal-hook.js",
]);
const builtinModuleNames = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export function isBuiltinModuleSpecifier(specifier, knownBuiltinModules = builtinModuleNames) {
  return specifier.startsWith("node:") || knownBuiltinModules.has(specifier);
}

export function normalizeBundleMetadataPath(path) {
  return path.replaceAll("\\", "/");
}

async function readPackFileList() {
  const { stdout } = await runPnpm(["--filter", "@lervo/cli", "pack", "--dry-run", "--json"]);
  const report = JSON.parse(stdout);
  if (report.name !== "@lervo/cli" || !Array.isArray(report.files)) {
    throw new ReleaseArtifactManifestError(
      "release_artifact_pack_report_invalid",
      "The CLI pack report is invalid.",
    );
  }
  return report.files.map(({ path }) => path).sort();
}

async function createArchiveSnapshot(paths) {
  if (!paths.includes("package.json")) {
    throw new ReleaseArtifactManifestError(
      "release_artifact_package_manifest_missing",
      "The release archive does not contain a package manifest.",
    );
  }
  const files = [];
  for (const path of paths) {
    if (path === "package.json") continue;
    if (!publicContentPaths.has(path)) {
      throw new ReleaseArtifactManifestError(
        "release_artifact_file_unexpected",
        "The release archive contains a disallowed file.",
      );
    }
    const contents = await readFile(resolve(cliRoot, path));
    files.push({ path, size: contents.byteLength, sha256: sha256(contents) });
  }
  return {
    rootFiles: ["package.json"],
    files,
    fileCount: paths.length,
    contentDigest: canonicalDigest(files),
  };
}

function directDependencyCoordinates(cliManifest) {
  return Object.entries(cliManifest.dependencies ?? {})
    .map(([name, requestedVersion]) => `${name}@${requestedVersion}`)
    .sort();
}

function externalPackageName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/", 1)[0];
}

export function bundledPackageRoot(path) {
  const parts = normalizeBundleMetadataPath(path).split("/");
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || nodeModulesIndex === parts.length - 1) return null;
  const packageEnd = parts[nodeModulesIndex + 1].startsWith("@")
    ? nodeModulesIndex + 3
    : nodeModulesIndex + 2;
  return parts.slice(0, packageEnd).join("/");
}

export function bundleOutputMetadata(metafile) {
  return Object.entries(metafile.outputs ?? {}).find(
    ([path]) => normalizeBundleMetadataPath(path) === bundleOutputPath,
  )?.[1];
}

async function createBundleSnapshot() {
  const metafile = await readJson(bundleMetafilePath);
  const output = bundleOutputMetadata(metafile);
  if (!output || !Array.isArray(output.imports)) {
    throw new ReleaseArtifactManifestError(
      "release_artifact_bundle_metadata_invalid",
      "The executable output was not found in the CLI bundle metadata.",
    );
  }

  const packageDirectories = [
    ...new Set(
      Object.keys(metafile.inputs ?? {})
        .map((path) => normalizeBundleMetadataPath(path).match(/^packages\/([^/]+)\/dist\//)?.[1])
        .filter(Boolean),
    ),
  ].sort();
  const workspacePackages = (
    await Promise.all(
      packageDirectories.map(async (directory) => {
        const manifest = await readJson(
          resolve(repositoryRoot, "packages", directory, "package.json"),
        );
        return `${manifest.name}@${manifest.version}`;
      }),
    )
  ).sort();
  const externalPackageRoots = [
    ...new Set(
      Object.keys(metafile.inputs ?? {})
        .map(bundledPackageRoot)
        .filter(Boolean),
    ),
  ].sort();
  const externalPackages = (
    await Promise.all(
      externalPackageRoots.map(async (packageRoot) => {
        const manifest = await readJson(resolve(repositoryRoot, packageRoot, "package.json"));
        return `${manifest.name}@${manifest.version}`;
      }),
    )
  ).sort();
  const externalImports = [
    ...new Set(
      output.imports
        .filter(({ external, path }) => external && !isBuiltinModuleSpecifier(path))
        .map(({ path }) => externalPackageName(path)),
    ),
  ].sort();
  const bundle = {
    entry: "apps/cli/src/bin.ts",
    output: "dist/bin.js",
    workspacePackages,
    externalPackages,
    externalImports,
  };
  return { ...bundle, bundleDigest: canonicalDigest(bundle) };
}

export async function createCliReleaseManifest(
  deploymentRoot,
  expectedFamilies,
  updateMode,
  options = {},
) {
  const [cliManifest, archivePaths, installedPackages, bundle] = await Promise.all([
    options.cliManifest === undefined
      ? readJson(cliManifestPath)
      : Promise.resolve(structuredClone(options.cliManifest)),
    readPackFileList(),
    collectInstalledPackages(resolve(deploymentRoot, "node_modules")),
    createBundleSnapshot(),
  ]);
  const artifact = {
    name: cliManifest.name,
    version: cliManifest.version,
    description: cliManifest.description,
    keywords: cliManifest.keywords,
    license: cliManifest.license,
    repository: cliManifest.repository?.url ?? null,
    registry: cliManifest.publishConfig?.registry ?? null,
    provenance: cliManifest.publishConfig?.provenance ?? null,
    private: cliManifest.private,
    access: cliManifest.publishConfig?.access,
    type: cliManifest.type,
    node: cliManifest.engines?.node,
    bin: cliManifest.bin?.lervo?.replace(/^\.\//, ""),
    files: cliManifest.files,
  };
  const directDependencies = directDependencyCoordinates(cliManifest);
  const archive = await createArchiveSnapshot(archivePaths);
  const classified = classifyDependencies(installedPackages, expectedFamilies, updateMode);
  const dependencies = {
    portable: classified.portable,
    portableDigest: canonicalDigest(classified.portable),
    platformSpecificFamilies: classified.platformSpecificFamilies,
  };
  return {
    schemaVersion: 5,
    artifact,
    directDependencies,
    bundle,
    archive,
    dependencies,
    artifactDigest: releaseArtifactDigest({
      artifact,
      directDependencies,
      bundle,
      archive,
      dependencies,
    }),
  };
}
