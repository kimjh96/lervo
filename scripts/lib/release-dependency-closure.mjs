import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { ReleaseArtifactManifestError } from "./release-artifact-manifest.mjs";
import { readJson } from "./installed-cli.mjs";

async function packageDirectories(nodeModulesRoot) {
  const directories = [];
  for (const entry of await readdir(nodeModulesRoot, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = resolve(nodeModulesRoot, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scopedEntry of await readdir(path, { withFileTypes: true })) {
        const scopedPath = resolve(path, scopedEntry.name);
        if ((await stat(scopedPath)).isDirectory()) directories.push(scopedPath);
      }
    } else if ((await stat(path)).isDirectory()) {
      directories.push(path);
    }
  }
  return directories;
}

async function addPackage(packages, packageRoot) {
  const manifest = await readJson(resolve(packageRoot, "package.json"));
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new ReleaseArtifactManifestError(
      "release_artifact_dependency_invalid",
      "The installed dependency identity is invalid.",
    );
  }
  packages.set(`${manifest.name}@${manifest.version}`, manifest);
}

async function addVirtualStorePackages(packages, virtualStore) {
  for (const entry of await readdir(virtualStore, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      for (const packageRoot of await packageDirectories(
        resolve(virtualStore, entry.name, "node_modules"),
      )) {
        await addPackage(packages, packageRoot);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  try {
    for (const packageRoot of await packageDirectories(resolve(virtualStore, "node_modules"))) {
      await addPackage(packages, packageRoot);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function collectInstalledPackages(nodeModulesRoot) {
  const packages = new Map();
  const visitNodeModules = async (root) => {
    for (const packageRoot of await packageDirectories(root)) {
      await addPackage(packages, packageRoot);
      try {
        await visitNodeModules(resolve(packageRoot, "node_modules"));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  };
  await visitNodeModules(nodeModulesRoot);
  await addVirtualStorePackages(packages, resolve(nodeModulesRoot, ".pnpm"));
  return packages;
}

function inferPlatformFamily(manifest) {
  const os = Array.isArray(manifest.os) && manifest.os.length === 1 ? manifest.os[0] : undefined;
  const cpu =
    Array.isArray(manifest.cpu) && manifest.cpu.length === 1 ? manifest.cpu[0] : undefined;
  const suffix = os && cpu ? `-${os}-${cpu}` : undefined;
  return {
    prefix:
      suffix && manifest.name.endsWith(suffix)
        ? `${manifest.name.slice(0, -suffix.length)}-`
        : manifest.name,
    version: manifest.version,
  };
}

export function classifyDependencies(packages, expectedFamilies, updateMode) {
  const portable = [];
  const inferredFamilies = new Map();
  for (const [coordinate, manifest] of packages) {
    const platformSpecific =
      (Array.isArray(manifest.os) && manifest.os.length > 0) ||
      (Array.isArray(manifest.cpu) && manifest.cpu.length > 0);
    if (!platformSpecific) {
      portable.push(coordinate);
      continue;
    }
    const inferred = inferPlatformFamily(manifest);
    inferredFamilies.set(`${inferred.prefix}@${inferred.version}`, inferred);
    if (
      !updateMode &&
      !expectedFamilies.some(
        ({ prefix, version }) => manifest.name.startsWith(prefix) && manifest.version === version,
      )
    ) {
      throw new ReleaseArtifactManifestError(
        "release_artifact_platform_dependency_unexpected",
        "A disallowed platform-specific dependency is installed.",
      );
    }
  }
  portable.sort();
  return {
    portable,
    platformSpecificFamilies: updateMode
      ? [...inferredFamilies.values()].sort((left, right) =>
          `${left.prefix}@${left.version}`.localeCompare(`${right.prefix}@${right.version}`),
        )
      : expectedFamilies,
  };
}
