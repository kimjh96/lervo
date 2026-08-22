import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = resolve(repositoryRoot, "apps/hub-runtime/dist/bin.js");
const result = spawnSync(process.execPath, [entrypoint], {
  cwd: repositoryRoot,
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "" },
});

assert.equal(result.status, 1);
assert.equal(result.stdout, "");
assert.equal(
  result.stderr,
  "Lervo Hub 오류 (invalid_arguments): 사용법: lervo-hub --config <config.json>\n",
);
console.log("빌드된 Lervo Hub runtime smoke 검사 통과");
