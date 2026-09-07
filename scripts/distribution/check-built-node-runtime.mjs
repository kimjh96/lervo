import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const entrypoint = resolve(repositoryRoot, "apps/node-runtime/dist/bin.js");
const isolatedRoot = await mkdtemp(resolve(tmpdir(), "lervo-built-node-runtime-"));
const isolatedEntrypoint = resolve(isolatedRoot, "node-runtime.js");
await copyFile(resolve(repositoryRoot, "apps/cli/dist/node-runtime.js"), isolatedEntrypoint);

try {
  for (const candidate of [entrypoint, isolatedEntrypoint]) {
    const result = spawnSync(process.execPath, [candidate], {
      cwd: isolatedRoot,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Lervo Node error (invalid_arguments): Usage: lervo-node --config <config.json> | --check-config <config.json>\n",
    );
  }
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
console.log("Built Lervo Node runtime smoke check passed");
