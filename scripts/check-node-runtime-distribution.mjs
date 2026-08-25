import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { repositoryRoot } from "./lib/installed-cli.mjs";

const execFileAsync = promisify(execFile);

async function run(script, args) {
  return execFileAsync(process.execPath, [resolve(repositoryRoot, script), ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180_000,
  });
}

const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-node-distribution-smoke-"));
try {
  const archive = resolve(fixtureRoot, `lervo-node-${process.platform}-${process.arch}.tar.gz`);
  const artifact = `${archive}.artifact.json`;
  const installed = resolve(fixtureRoot, "installed");
  const built = await run("scripts/build-node-runtime-distribution.mjs", [
    "--output",
    archive,
    "--write",
  ]);
  assert.match(built.stdout, /Created and verified the standalone Lervo Node distribution\./u);
  const descriptor = JSON.parse(await readFile(artifact, "utf8"));
  const verified = await run("scripts/verify-node-runtime-distribution.mjs", [
    "--archive",
    archive,
    "--artifact",
    artifact,
    "--expected-sha256",
    descriptor.sha256,
  ]);
  assert.match(verified.stdout, /Lervo Node distribution verification passed/u);
  const installedResult = await run("scripts/install-node-runtime-distribution.mjs", [
    "--archive",
    archive,
    "--artifact",
    artifact,
    "--expected-sha256",
    descriptor.sha256,
    "--target",
    installed,
    "--write",
  ]);
  assert.match(installedResult.stdout, /The service was not enabled\./u);
  await access(resolve(installed, "dist/bin.js"));
  await access(resolve(installed, "lervo-node-distribution.manifest.json"));

  await assert.rejects(
    run("scripts/install-node-runtime-distribution.mjs", [
      "--archive",
      archive,
      "--artifact",
      artifact,
      "--expected-sha256",
      descriptor.sha256,
      "--target",
      installed,
      "--write",
    ]),
  );

  await assert.rejects(
    run("scripts/verify-node-runtime-distribution.mjs", [
      "--archive",
      archive,
      "--artifact",
      artifact,
      "--expected-sha256",
      `sha256:${"0".repeat(64)}`,
    ]),
  );
  console.log(
    `Standalone Lervo Node distribution smoke check passed (${descriptor.platform.os}-${descriptor.platform.arch}-${descriptor.platform.libc})`,
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
