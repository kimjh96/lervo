import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { readJson, repositoryRoot, runPnpm } from "./lib/installed-cli.mjs";
import { verifyInstalledClaudeNativeRuntime } from "./lib/claude-native-runtime.mjs";
import { packCliArtifact } from "./lib/packed-cli-artifact.mjs";

const cliManifestPath = resolve(repositoryRoot, "apps/cli/package.json");

async function collectFiles(directory, prefix = "") {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (prefix === "" && entry.name === "node_modules") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...(await collectFiles(resolve(directory, entry.name), path)));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

async function installTarball(consumerRoot, tarballPath) {
  await writeFile(
    resolve(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "lervo-packed-cli-consumer",
        version: "0.0.0",
        private: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await runPnpm(["add", "--prefer-offline", "--save-exact", tarballPath], { cwd: consumerRoot });
}

async function verifyInstalledPackage(consumerRoot, expectedManifest) {
  const packageRoot = resolve(consumerRoot, "node_modules/@lervo/cli");
  const manifest = await readJson(resolve(packageRoot, "package.json"));
  assert.equal(manifest.name, "@lervo/cli");
  assert.equal(manifest.version, expectedManifest.version);
  assert.equal(
    manifest.description,
    "Lervo CLI for managing AI agent execution and evidence in local repositories",
  );
  assert.deepEqual(manifest.keywords, ["ai-agents", "local-first", "orchestration"]);
  assert.equal(manifest.license, expectedManifest.license);
  assert.deepEqual(manifest.repository, expectedManifest.repository);
  assert.deepEqual(manifest.publishConfig, expectedManifest.publishConfig);
  assert.equal(manifest.private, false);
  assert.deepEqual(manifest.engines, { node: ">=22.13" });
  assert.deepEqual(manifest.bin, {
    lervo: "./dist/bin.js",
    "lervo-node": "./dist/node-runtime.js",
  });
  assert.deepEqual(manifest.files, [
    "README.md",
    "dist/bin.js",
    "dist/node-runtime.js",
    "dist/terminal-hook.js",
  ]);
  assert.deepEqual(manifest.dependencies, {
    "@anthropic-ai/claude-agent-sdk": "0.3.226",
    "@anthropic-ai/sdk": "0.117.1",
    "@modelcontextprotocol/sdk": "1.30.0",
    zod: "4.4.3",
  });
  assert.equal(Object.hasOwn(manifest, "main"), false);
  assert.equal(Object.hasOwn(manifest, "types"), false);
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  assert.equal(
    ["preinstall", "install", "postinstall"].some((name) =>
      Object.hasOwn(manifest.scripts ?? {}, name),
    ),
    false,
  );
  assert.deepEqual(await collectFiles(packageRoot), [
    "README.md",
    "dist/bin.js",
    "dist/node-runtime.js",
    "dist/terminal-hook.js",
    "package.json",
  ]);
  assert.deepEqual((await readdir(resolve(consumerRoot, "node_modules/@lervo"))).sort(), ["cli"]);

  const entry = await readFile(resolve(packageRoot, "dist/bin.js"), "utf8");
  assert.equal(entry.startsWith("#!/usr/bin/env node\n"), true);
  const terminalHook = await readFile(resolve(packageRoot, "dist/terminal-hook.js"), "utf8");
  assert.equal(terminalHook.startsWith("#!/usr/bin/env node\n"), true);
  const nodeRuntime = await readFile(resolve(packageRoot, "dist/node-runtime.js"), "utf8");
  assert.equal(nodeRuntime.startsWith("#!/usr/bin/env node\n"), true);
  const shimName = process.platform === "win32" ? "lervo.CMD" : "lervo";
  await access(resolve(consumerRoot, "node_modules/.bin", shimName));
  const nodeShimName = process.platform === "win32" ? "lervo-node.CMD" : "lervo-node";
  await access(resolve(consumerRoot, "node_modules/.bin", nodeShimName));
}

async function verifyPackageGuide(consumerRoot) {
  const guide = await readFile(resolve(consumerRoot, "node_modules/@lervo/cli/README.md"), "utf8");
  assert.ok(Buffer.byteLength(guide, "utf8") <= 4 * 1024);
  assert.equal(guide.startsWith("# @lervo/cli\n"), true);
  assert.deepEqual(
    [...guide.matchAll(/^## (.+)$/gmu)].map((match) => match[1]),
    [
      "Requirements",
      "Install",
      "First use",
      "Semantic knowledge",
      "Documents and provider entrypoints",
      "Exchange and managed execution",
    ],
  );
  for (const requiredText of [
    "Node.js 22.13 or later",
    "npm install --global @lervo/cli",
    "lervo init --name my-project",
    "lervo init --dry-run --name my-project",
    "lervo --help",
  ]) {
    assert.equal(guide.includes(requiredText), true);
  }
  assert.match(
    guide,
    /\b(?:works?|operates?|runs?) without a Hub\b|\bdo(?:es)? not require a Hub\b/u,
  );
}

async function runConsumerCli(consumerRoot, args) {
  return runPnpm(["exec", "lervo", ...args], { cwd: consumerRoot });
}

async function verifyConsumerCommands(consumerRoot, expectedVersion) {
  const version = await runConsumerCli(consumerRoot, ["--version"]);
  assert.equal(version.stdout, `lervo ${expectedVersion}\n`);
  assert.equal(version.stderr, "");

  const capabilities = await runConsumerCli(consumerRoot, ["trace", "--capabilities"]);
  assert.equal(capabilities.stderr, "");
  const report = JSON.parse(capabilities.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.defaultMode, "page");
  assert.deepEqual(report.deprecations, []);

  const initialized = await runConsumerCli(consumerRoot, ["init", "--name", "packed-cli-smoke"]);
  assert.equal(initialized.stderr, "");
  await access(resolve(consumerRoot, ".lervo/project.yaml"));
}

async function main() {
  const cliManifest = await readJson(cliManifestPath);
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-packed-cli-"));
  try {
    const archiveRoot = resolve(fixtureRoot, "archive");
    const consumerRoot = resolve(fixtureRoot, "consumer");
    await Promise.all([mkdir(archiveRoot), mkdir(consumerRoot)]);
    const tarballPath = await packCliArtifact(archiveRoot, cliManifest.version);
    await installTarball(consumerRoot, tarballPath);
    await verifyInstalledPackage(consumerRoot, cliManifest);
    await verifyPackageGuide(consumerRoot);
    const nativeRuntime = await verifyInstalledClaudeNativeRuntime(consumerRoot);
    await verifyConsumerCommands(consumerRoot, cliManifest.version);
    console.log(`Claude native runtime verified: ${nativeRuntime.packageName}`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  console.log(`Packed Lervo CLI consumer installation check passed (${cliManifest.version})`);
}

await main();
