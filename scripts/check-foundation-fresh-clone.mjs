import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { foundationSourceRevision } from "./foundation-evidence/source-revision.mjs";

const execute = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const json = process.argv.includes("--json");

async function run(command, args, cwd, maxBuffer = 8 * 1024 * 1024) {
  return execute(command, args, {
    cwd,
    env: { ...process.env, CI: "1" },
    timeout: 10 * 60 * 1000,
    maxBuffer,
  });
}

const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-foundation-clone-"));
try {
  const cloneRoot = resolve(fixtureRoot, "clone");
  const projectRoot = resolve(fixtureRoot, "project");
  await run(
    "git",
    ["clone", "--quiet", "--no-local", "--depth", "1", repositoryRoot, cloneRoot],
    fixtureRoot,
  );
  assert.equal(
    await foundationSourceRevision(cloneRoot),
    await foundationSourceRevision(repositoryRoot),
    "The clean clone does not contain the exact current source revision.",
  );
  await assert.rejects(access(resolve(cloneRoot, ".lervo/state")), { code: "ENOENT" });
  await run("pnpm", ["install", "--offline", "--frozen-lockfile"], cloneRoot);
  await run("pnpm", ["--filter", "@lervo/cli...", "build"], cloneRoot);
  await mkdir(projectRoot);
  const cli = resolve(cloneRoot, "apps/cli/dist/bin.js");
  const initialized = await run(
    process.execPath,
    [cli, "init", "--minimal", "--name", "foundation-fresh-clone"],
    projectRoot,
  );
  assert.equal(initialized.stderr, "");
  await access(resolve(projectRoot, ".lervo/project.yaml"));
  const state = await run(process.execPath, [cli, "state", "status", "--json"], projectRoot);
  const writer = await run(
    process.execPath,
    [cli, "event-contract", "status", "--json"],
    projectRoot,
  );
  const stateReport = JSON.parse(state.stdout);
  const writerReport = JSON.parse(writer.stdout);
  assert.equal(writerReport.coordinate.selectedEventSchemaVersion, 1);
  const result = {
    status: "passed",
    sourceRevision: await foundationSourceRevision(cloneRoot),
    localWithoutHub: true,
    projectInitialized: true,
    stateStatus: stateReport.status,
    selectedEventSchemaVersion: writerReport.coordinate.selectedEventSchemaVersion,
  };
  process.stdout.write(
    json
      ? `${JSON.stringify(result)}\n`
      : `Foundation fresh-clone check passed (${result.sourceRevision}).\n`,
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
