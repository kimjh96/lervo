import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createCliReleaseManifest } from "./lib/cli-release-snapshot.mjs";
import {
  releaseArtifactDifferences,
  ReleaseArtifactManifestError,
  validateReleaseArtifactManifest,
} from "./lib/release-artifact-manifest.mjs";
import { deployBuiltCli, readJson, repositoryRoot } from "./lib/installed-cli.mjs";

const releaseManifestPath = resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json");
const writeMode = process.argv.slice(2).includes("--write");

async function main() {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-release-artifact-"));
  try {
    const deploymentRoot = resolve(fixtureRoot, "installation");
    await deployBuiltCli(deploymentRoot);
    let expected;
    if (!writeMode) expected = validateReleaseArtifactManifest(await readJson(releaseManifestPath));
    const actual = validateReleaseArtifactManifest(
      await createCliReleaseManifest(
        deploymentRoot,
        expected?.dependencies.platformSpecificFamilies ?? [],
        writeMode,
      ),
    );
    if (writeMode) {
      await writeFile(releaseManifestPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
      console.log("Updated the CLI release artifact manifest.");
      return;
    }
    const differences = releaseArtifactDifferences(expected, actual);
    if (differences.length > 0) {
      throw new ReleaseArtifactManifestError(
        "release_artifact_mismatch",
        `The release artifact differs from the approved manifest: ${differences.join(", ")}`,
      );
    }
    console.log(
      `CLI release artifact check passed (${actual.archive.fileCount} files, ` +
        `${actual.dependencies.portable.length} portable dependencies)`,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ReleaseArtifactManifestError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(
      "release_artifact_check_failed: The release artifact check could not be completed.",
    );
  }
  process.exitCode = 1;
}
