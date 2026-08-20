import { readFile } from "node:fs/promises";
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
    if (!/^dist\/.+\.(?:js|d\.ts)$/.test(path)) {
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

async function directDependencyCoordinates(cliManifest) {
  const coordinates = [];
  for (const [name, requestedVersion] of Object.entries(cliManifest.dependencies ?? {})) {
    if (!requestedVersion.startsWith("workspace:")) {
      coordinates.push(`${name}@${requestedVersion}`);
      continue;
    }
    const packageDirectory = name.slice("@lervo/".length);
    const manifest = await readJson(resolve(repositoryRoot, "packages", packageDirectory, "package.json"));
    coordinates.push(`${name}@${manifest.version}`);
  }
  return coordinates.sort();
}

export async function createCliReleaseManifest(
  deploymentRoot,
  expectedFamilies,
  updateMode,
) {
  const [cliManifest, archivePaths, installedPackages] = await Promise.all([
    readJson(cliManifestPath),
    readPackFileList(),
    collectInstalledPackages(resolve(deploymentRoot, "node_modules")),
  ]);
  const artifact = {
    name: cliManifest.name,
    version: cliManifest.version,
    private: cliManifest.private,
    type: cliManifest.type,
    bin: cliManifest.bin?.lervo?.replace(/^\.\//, ""),
    main: cliManifest.main?.replace(/^\.\//, ""),
    types: cliManifest.types?.replace(/^\.\//, ""),
    files: cliManifest.files,
  };
  const directDependencies = await directDependencyCoordinates(cliManifest);
  const archive = await createArchiveSnapshot(archivePaths);
  const classified = classifyDependencies(installedPackages, expectedFamilies, updateMode);
  const dependencies = {
    portable: classified.portable,
    portableDigest: canonicalDigest(classified.portable),
    platformSpecificFamilies: classified.platformSpecificFamilies,
  };
  return {
    schemaVersion: 1,
    artifact,
    directDependencies,
    archive,
    dependencies,
    artifactDigest: canonicalDigest({
      artifact,
      directDependencies,
      archiveContentDigest: archive.contentDigest,
      portableDependenciesDigest: dependencies.portableDigest,
      platformSpecificFamilies: dependencies.platformSpecificFamilies,
    }),
  };
}
