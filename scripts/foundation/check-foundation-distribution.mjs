import { resolve } from "node:path";

import { runFoundationCommand } from "./readiness/command-runner.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const scripts = [
  "scripts/release/commands/check-cli-release-artifact.mjs",
  "scripts/release/commands/check-cli-release-sbom.mjs",
  "scripts/release/commands/check-cli-release-attestation.mjs",
  "scripts/distribution/check-built-cli.mjs",
  "scripts/distribution/check-built-hub-runtime.mjs",
  "scripts/distribution/check-hub-runtime-distribution.mjs",
  "scripts/distribution/check-built-node-runtime.mjs",
  "scripts/distribution/check-node-runtime-distribution.mjs",
  "scripts/release/commands/check-packed-cli.mjs",
  "scripts/release/commands/check-registry-publish.mjs",
];
for (const script of scripts) {
  await runFoundationCommand({
    checkId: script,
    command: process.execPath,
    args: [resolve(repositoryRoot, script)],
    repositoryRoot,
  });
}
process.stdout.write(`Foundation distribution checks passed (${scripts.length} boundaries).\n`);
