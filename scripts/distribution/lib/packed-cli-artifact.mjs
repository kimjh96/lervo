import { cliReleaseFiles } from "../../shared/cli-release-files.mjs";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { basename, relative } from "node:path";

import { runPnpm } from "./installed-cli.mjs";

export async function packCliArtifact(archiveRoot, expectedVersion) {
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
