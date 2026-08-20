import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

import {
  createCliReleaseSbom,
  ReleaseSbomError,
  validateCliReleaseSbom,
} from "./lib/cli-release-sbom.mjs";
import { readJson, repositoryRoot } from "./lib/installed-cli.mjs";
import {
  ReleaseArtifactManifestError,
  validateReleaseArtifactManifest,
} from "./lib/release-artifact-manifest.mjs";
import { PnpmProductionGraphError } from "./lib/pnpm-production-graph.mjs";

const releaseManifestPath = resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json");
const releaseSbomPath = resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json");
const lockfilePath = resolve(repositoryRoot, "pnpm-lock.yaml");
const writeMode = process.argv.slice(2).includes("--write");

async function main() {
  const [releaseManifest, lockfile] = await Promise.all([
    readJson(releaseManifestPath).then(validateReleaseArtifactManifest),
    readFile(lockfilePath, "utf8").then(parse),
  ]);
  const expected = validateCliReleaseSbom(
    createCliReleaseSbom(releaseManifest, lockfile),
    releaseManifest,
    lockfile,
  );
  if (writeMode) {
    await writeFile(releaseSbomPath, `${JSON.stringify(expected, null, 2)}\n`, "utf8");
    console.log("CLI release SBOM을 갱신했습니다.");
    return;
  }
  validateCliReleaseSbom(await readJson(releaseSbomPath), releaseManifest, lockfile);
  console.log(
    `CLI release SBOM 검사 통과 (${expected.components.length}개 component, ` +
    `${expected.dependencies.length}개 dependency node)`,
  );
}

try {
  await main();
} catch (error) {
  if (
    error instanceof ReleaseSbomError ||
    error instanceof ReleaseArtifactManifestError ||
    error instanceof PnpmProductionGraphError
  ) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error("release_sbom_check_failed: CLI release SBOM 검사를 완료하지 못했습니다.");
  }
  process.exitCode = 1;
}
