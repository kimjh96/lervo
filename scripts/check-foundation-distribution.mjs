import { resolve } from "node:path";

import { runFoundationCommand } from "./foundation-readiness/command-runner.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const scripts = [
  "check-cli-release-artifact.mjs",
  "check-cli-release-sbom.mjs",
  "check-cli-release-attestation.mjs",
  "check-built-cli.mjs",
  "check-built-hub-runtime.mjs",
  "check-hub-runtime-distribution.mjs",
  "check-built-node-runtime.mjs",
  "check-node-runtime-distribution.mjs",
  "check-packed-cli.mjs",
  "check-registry-publish.mjs",
];
for (const script of scripts) {
  await runFoundationCommand({
    checkId: script,
    command: process.execPath,
    args: [resolve(repositoryRoot, "scripts", script)],
    repositoryRoot,
  });
}
process.stdout.write(`Foundation distribution checks passed (${scripts.length} boundaries).\n`);
