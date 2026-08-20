import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createCliReleaseManifest } from "./lib/cli-release-snapshot.mjs";
import {
  releaseArtifactDifferences,
  ReleaseArtifactManifestError,
  validateReleaseArtifactManifest,
} from "./lib/release-artifact-manifest.mjs";
import {
  deployBuiltCli,
  readJson,
  repositoryRoot,
} from "./lib/installed-cli.mjs";

const releaseManifestPath = resolve(
  repositoryRoot,
  "apps/cli/release-artifact-manifest.json",
);
const writeMode = process.argv.slice(2).includes("--write");

async function main() {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-release-artifact-"));
  try {
    const deploymentRoot = resolve(fixtureRoot, "installation");
    await deployBuiltCli(deploymentRoot);
    let expected;
    if (!writeMode) expected = validateReleaseArtifactManifest(await readJson(releaseManifestPath));
    const actual = validateReleaseArtifactManifest(await createCliReleaseManifest(
      deploymentRoot,
      expected?.dependencies.platformSpecificFamilies ?? [],
      writeMode,
    ));
    if (writeMode) {
      await writeFile(releaseManifestPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
      console.log("CLI release artifact manifest를 갱신했습니다.");
      return;
    }
    const differences = releaseArtifactDifferences(expected, actual);
    if (differences.length > 0) {
      throw new ReleaseArtifactManifestError(
        "release_artifact_mismatch",
        `Release artifact가 승인된 manifest와 다릅니다: ${differences.join(", ")}`,
      );
    }
    console.log(
      `CLI release artifact 검사 통과 (${actual.archive.fileCount}개 파일, ` +
      `${actual.dependencies.portable.length}개 portable dependency)`,
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
    console.error("release_artifact_check_failed: Release artifact 검사를 완료하지 못했습니다.");
  }
  process.exitCode = 1;
}
