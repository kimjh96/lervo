import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";

import {
  recordVerificationBuild,
  verificationBuildCurrent,
  verificationBuildInputDigest,
} from "./lib/verification-build-cache.mjs";

const builtOutputs = [
  "apps/cli/dist/bin.js",
  "apps/node-runtime/dist/bin.js",
  "apps/hub-runtime/dist/bin.js",
];
const gitMetadata = lstatSync(".git");
const run = (label, args, timeout) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit", timeout });
  if (result.error)
    throw new Error(`Isolated verification ${label} failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `Isolated verification ${label} exited ${result.status ?? "without a status"}.`,
    );
  }
};
if (gitMetadata.isFile()) run("install", ["install", "--frozen-lockfile", "--offline"], 300_000);
// Rebuilding identical inputs cannot change outputs; documentation-only effects reuse the build.
const digest = verificationBuildInputDigest(".");
if (verificationBuildCurrent(".", digest, builtOutputs)) {
  console.log(`Isolated verification build reused for ${digest}.`);
} else {
  run("build", ["build"], 1_200_000);
  recordVerificationBuild(".", digest);
}
