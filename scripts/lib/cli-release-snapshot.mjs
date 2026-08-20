import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";

import {
  canonicalDigest,
  ReleaseArtifactManifestError,
  sha256,
} from "./release-artifact-manifest.mjs";
import { collectInstalledPackages, classifyDependencies } from "./release-dependency-closure.mjs";
import { readJson, repositoryRoot, runPnpm } from "./installed-cli.mjs";

const cliRoot = resolve(repositoryRoot, "apps/cli");
const cliManifestPath = resolve(cliRoot, "package.json");
const bundleMetafilePath = resolve(cliRoot, "dist/bin.metafile.json");
const bundleOutputPath = "apps/cli/dist/bin.js";
const publicContentPaths = new Set(["README.md", "dist/bin.js"]);
const builtinModuleNames = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

async function readPackFileList() {
  const { stdout } = await runPnpm([
    "--filter",
    "@lervo/cli",
    "pack",
    "--dry-run",
    "--json",
  ]);
  const report = JSON.parse(stdout);
  if (report.name !== "@lervo/cli" || !Array.isArray(report.files)) {
    throw new ReleaseArtifactManifestError(
      "release_artifact_pack_report_invalid",
      "CLI pack report가 올바르지 않습니다.",
    );
  }
  return report.files.map(({ path }) => path).sort();
}

async function createArchiveSnapshot(paths) {
  if (!paths.includes("package.json")) {
    throw new ReleaseArtifactManifestError(
      "release_artifact_package_manifest_missing",
      "Release archive에 package manifest가 없습니다.",
    );
  }
  const files = [];
  for (const path of paths) {
    if (path === "package.json") continue;
    if (!publicContentPaths.has(path)) {
      throw new ReleaseArtifactManifestError(
        "release_artifact_file_unexpected",
        "Release archive에 허용되지 않은 파일이 있습니다.",
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

async function createBundleSnapshot() {
  const metafile = await readJson(bundleMetafilePath);
  const output = metafile.outputs?.[bundleOutputPath];
  if (!output || !Array.isArray(output.imports)) {
    throw new ReleaseArtifactManifestError(
      "release_artifact_bundle_metadata_invalid",
      "CLI bundle metadata에서 실행 출력을 찾지 못했습니다.",
    );
  }

  const packageDirectories = [...new Set(
    Object.keys(metafile.inputs ?? {})
      .map((path) => path.match(/^packages\/([^/]+)\/dist\//)?.[1])
      .filter(Boolean),
  )].sort();
  const workspacePackages = (await Promise.all(packageDirectories.map(async (directory) => {
    const manifest = await readJson(resolve(repositoryRoot, "packages", directory, "package.json"));
    return `${manifest.name}@${manifest.version}`;
  }))).sort();
  const externalImports = [...new Set(
    output.imports
      .filter(({ external, path }) => external && !builtinModuleNames.has(path))
      .map(({ path }) => externalPackageName(path)),
  )].sort();
  const bundle = {
    entry: "apps/cli/src/bin.ts",
    output: "dist/bin.js",
    workspacePackages,
    externalImports,
  };
  return { ...bundle, bundleDigest: canonicalDigest(bundle) };
}

export async function createCliReleaseManifest(
  deploymentRoot,
  expectedFamilies,
  updateMode,
) {
  const [cliManifest, archivePaths, installedPackages, bundle] = await Promise.all([
    readJson(cliManifestPath),
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
    schemaVersion: 3,
    artifact,
    directDependencies,
    bundle,
    archive,
    dependencies,
    artifactDigest: canonicalDigest({
      artifact,
      directDependencies,
      bundleDigest: bundle.bundleDigest,
      archiveContentDigest: archive.contentDigest,
      portableDependenciesDigest: dependencies.portableDigest,
      platformSpecificFamilies: dependencies.platformSpecificFamilies,
    }),
  };
}
