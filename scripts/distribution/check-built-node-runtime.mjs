import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  describeInstalledNodeLauncher,
  inspectInstalledNodeDependencies,
  materializeInstalledNodeLauncher,
} from "../../apps/cli/dist/node-fleet-runtime-material.js";

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
  const token = resolve(isolatedRoot, "hub.token");
  const config = resolve(isolatedRoot, "config.json");
  await writeFile(token, "h".repeat(40), { mode: 0o600 });
  await writeFile(
    config,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: isolatedRoot,
      hub: {
        baseUrl: "https://hub.example.test/",
        bearerTokenFile: token,
        destinationId: "hub:runtime-smoke",
        hubIdentityHash: `sha256:${"9".repeat(64)}`,
      },
      sync: { workerId: "node:runtime-smoke" },
    }),
    { mode: 0o600 },
  );
  const missing = spawnSync(process.execPath, [isolatedEntrypoint, "--check-config", config], {
    encoding: "utf8",
    cwd: isolatedRoot,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Lervo Node error \(runtime_dependency_unavailable\)/u);

  await materializeInstalledNodeLauncher(isolatedRoot);
  const installed = await describeInstalledNodeLauncher(isolatedRoot);
  assert.equal(await inspectInstalledNodeDependencies(installed), "current");
  const checked = spawnSync(process.execPath, [installed.payload, "--check-config", config], {
    encoding: "utf8",
    cwd: isolatedRoot,
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stdout, "Lervo Node configuration preflight passed.\n");
  const initialized = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import { realpathSync } from 'node:fs';
    import { sep } from 'node:path';
    const entry = createRequire(${JSON.stringify(installed.payload)}).resolve('@anthropic-ai/claude-agent-sdk');
    if (!entry.startsWith(realpathSync(${JSON.stringify(dirname(installed.payload))}) + sep)) throw new Error('Dependency escaped the installed runtime');
    const {startup} = await import(pathToFileURL(entry));
    const query = await startup({initializeTimeoutMs:15000, options:{cwd:process.cwd(), settingSources:[], tools:[], mcpServers:{}, plugins:[]}});
    query.close();
    console.log('Installed SDK initialized');
  `,
    ],
    {
      encoding: "utf8",
      cwd: isolatedRoot,
      env: { PATH: dirname(process.execPath), HOME: isolatedRoot, TMPDIR: isolatedRoot },
      timeout: 25000,
    },
  );
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(initialized.stdout, "Installed SDK initialized\n");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
console.log("Built Lervo Node runtime smoke check passed");
