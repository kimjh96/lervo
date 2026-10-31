import { readRuntimeModuleArtifact } from "../../../packages/runtime-security/dist/index.js";
import { cliReleaseFilesForSchema } from "../../shared/cli-release-files.mjs";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import { repositoryRoot, runPnpm } from "./installed-cli.mjs";

export async function packCliArtifact(archiveRoot, expectedVersion) {
  const runtime = await readRuntimeModuleArtifact(resolve(repositoryRoot, "apps/cli/dist"));
  const cliReleaseFiles = cliReleaseFilesForSchema(
    10,
    [...runtime.files.keys()]
      .filter((name) => name !== "repository-runtime.json")
      .map((name) => `dist/${name}`),
  );
  const { stdout } = await runPnpm([
    "--filter",
    "@lervo/cli",
    "pack",
    "--pack-destination",
    archiveRoot,
    "--json",
  ]);
  const report = JSON.parse(stdout);
  assert.equal(report.name, "@lervo/cli");
  assert.equal(report.version, expectedVersion);
  assert.deepEqual(report.files.map(({ path }) => path).sort(), [
    ...cliReleaseFiles,
    "package.json",
  ]);
  assert.equal(basename(report.filename), `lervo-cli-${expectedVersion}.tgz`);
  assert.equal(relative(archiveRoot, report.filename), basename(report.filename));
  await access(report.filename);
  return report.filename;
}
