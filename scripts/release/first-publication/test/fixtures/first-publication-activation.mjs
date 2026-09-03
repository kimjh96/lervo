import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";

export const activationRepositoryRoot = resolve(import.meta.dirname, "../../../../..");
export const activationRepository = "lervo-dev/lervo";

export async function currentActivationSources() {
  const [packageManifest, releaseManifest] = await Promise.all([
    readFile(resolve(activationRepositoryRoot, "apps/cli/package.json"), "utf8").then(JSON.parse),
    readFile(
      resolve(activationRepositoryRoot, "apps/cli/release-artifact-manifest.json"),
      "utf8",
    ).then(JSON.parse),
  ]);
  return { packageManifest, releaseManifest };
}

export function replaceActivationReleaseArtifact(releaseManifest, changes) {
  const updated = structuredClone(releaseManifest);
  updated.artifact = { ...updated.artifact, ...changes };
  updated.artifactDigest = canonicalDigest({
    artifact: updated.artifact,
    directDependencies: updated.directDependencies,
    bundleDigest: updated.bundle.bundleDigest,
    archiveContentDigest: updated.archive.contentDigest,
    portableDependenciesDigest: updated.dependencies.portableDigest,
    platformSpecificFamilies: updated.dependencies.platformSpecificFamilies,
  });
  return updated;
}

export async function createActivationSourceFiles(sources) {
  const resolvedSources = sources ?? (await currentActivationSources());
  const root = await mkdtemp(resolve(tmpdir(), "lervo-activation-blockers-"));
  const paths = {
    packageManifestPath: resolve(root, "package.json"),
    releaseManifestPath: resolve(root, "release-manifest.json"),
  };
  await Promise.all([
    writeFile(
      paths.packageManifestPath,
      `${JSON.stringify(resolvedSources.packageManifest, null, 2)}\n`,
    ),
    writeFile(
      paths.releaseManifestPath,
      `${JSON.stringify(resolvedSources.releaseManifest, null, 2)}\n`,
    ),
  ]);
  return { root, paths, sources: resolvedSources };
}
