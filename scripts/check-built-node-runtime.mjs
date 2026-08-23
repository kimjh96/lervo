import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const entrypoint = resolve(repositoryRoot, "apps/node-runtime/dist/bin.js");
const result = spawnSync(process.execPath, [entrypoint], {
  cwd: repositoryRoot,
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "" },
});

assert.equal(result.status, 1);
assert.equal(result.stdout, "");
assert.equal(
  result.stderr,
  "Lervo Node error (invalid_arguments): Usage: lervo-node --config <config.json>\n",
);
console.log("Built Lervo Node runtime smoke check passed");
