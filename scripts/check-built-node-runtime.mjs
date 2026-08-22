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
  "Lervo Node 오류 (invalid_arguments): 사용법: lervo-node --config <config.json>\n",
);
console.log("빌드된 Lervo Node runtime smoke 검사 통과");
