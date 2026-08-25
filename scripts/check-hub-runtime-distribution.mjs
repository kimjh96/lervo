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

const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-hub-distribution-smoke-"));
try {
  const archive = resolve(fixtureRoot, `lervo-hub-${process.platform}-${process.arch}.tar.gz`);
  const artifact = `${archive}.artifact.json`;
  const installed = resolve(fixtureRoot, "installed");
  const built = await run("scripts/build-hub-runtime-distribution.mjs", [
    "--output",
    archive,
    "--write",
  ]);
  assert.match(built.stdout, /Created and verified the standalone Lervo Hub distribution\./u);
  const descriptor = JSON.parse(await readFile(artifact, "utf8"));
  const verified = await run("scripts/verify-hub-runtime-distribution.mjs", [
    "--archive",
    archive,
    "--artifact",
    artifact,
    "--expected-sha256",
    descriptor.sha256,
  ]);
  assert.match(verified.stdout, /Lervo Hub distribution verification passed/u);
  const installedResult = await run("scripts/install-hub-runtime-distribution.mjs", [
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
  await access(resolve(installed, "assets/trace.html"));
  await access(resolve(installed, "lervo-hub-distribution.manifest.json"));
  await assert.rejects(
    run("scripts/install-hub-runtime-distribution.mjs", [
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
    run("scripts/verify-hub-runtime-distribution.mjs", [
      "--archive",
      archive,
      "--artifact",
      artifact,
      "--expected-sha256",
      `sha256:${"0".repeat(64)}`,
    ]),
  );
  console.log(
    `Standalone Lervo Hub distribution smoke check passed (${descriptor.platform.os}-${descriptor.platform.arch}-${descriptor.platform.libc})`,
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
