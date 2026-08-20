import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve } from "node:path";

import { readJson, repositoryRoot, runPnpm } from "./lib/installed-cli.mjs";

const cliManifestPath = resolve(repositoryRoot, "apps/cli/package.json");

async function collectFiles(directory, prefix = "") {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (prefix === "" && entry.name === "node_modules") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...await collectFiles(resolve(directory, entry.name), path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

async function packCli(archiveRoot, expectedVersion) {
  const { stdout } = await runPnpm([
    "--filter",
    "@lervo/cli",
    "pack",
    "--pack-destination",
    archiveRoot,
    "--json",
  ]);
  const report = JSON.parse(stdout);
  assert.equal(report.name, "@lervo/cli");
  assert.equal(report.version, expectedVersion);
  assert.deepEqual(
    report.files.map(({ path }) => path).sort(),
    ["dist/bin.js", "package.json"],
  );
  assert.equal(basename(report.filename), `lervo-cli-${expectedVersion}.tgz`);
  assert.equal(relative(archiveRoot, report.filename), basename(report.filename));
  await access(report.filename);
  return report.filename;
}

async function installTarball(consumerRoot, tarballPath) {
  await writeFile(
    resolve(consumerRoot, "package.json"),
    `${JSON.stringify({
      name: "lervo-packed-cli-consumer",
      version: "0.0.0",
      private: true,
    }, null, 2)}\n`,
    "utf8",
  );
  await runPnpm(
    [
      "add",
      "--prefer-offline",
      "--save-exact",
      tarballPath,
    ],
    { cwd: consumerRoot },
  );
}

async function verifyInstalledPackage(consumerRoot, expectedVersion) {
  const packageRoot = resolve(consumerRoot, "node_modules/@lervo/cli");
  const manifest = await readJson(resolve(packageRoot, "package.json"));
  assert.equal(manifest.name, "@lervo/cli");
  assert.equal(manifest.version, expectedVersion);
  assert.equal(manifest.private, false);
  assert.deepEqual(manifest.engines, { node: ">=22.13" });
  assert.deepEqual(manifest.bin, { lervo: "./dist/bin.js" });
  assert.deepEqual(manifest.files, ["dist/bin.js"]);
  assert.deepEqual(manifest.dependencies, {
    "@anthropic-ai/claude-agent-sdk": "0.3.226",
    "@anthropic-ai/sdk": "0.117.1",
    "@modelcontextprotocol/sdk": "1.30.0",
    "zod": "4.4.3",
  });
  assert.equal(Object.hasOwn(manifest, "main"), false);
  assert.equal(Object.hasOwn(manifest, "types"), false);
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  assert.equal(
    ["preinstall", "install", "postinstall"].some((name) =>
      Object.hasOwn(manifest.scripts ?? {}, name)
    ),
    false,
  );
  assert.deepEqual(await collectFiles(packageRoot), ["dist/bin.js", "package.json"]);
  assert.deepEqual(
    (await readdir(resolve(consumerRoot, "node_modules/@lervo"))).sort(),
    ["cli"],
  );

  const entry = await readFile(resolve(packageRoot, "dist/bin.js"), "utf8");
  assert.equal(entry.startsWith("#!/usr/bin/env node\n"), true);
  const shimName = process.platform === "win32" ? "lervo.CMD" : "lervo";
  await access(resolve(consumerRoot, "node_modules/.bin", shimName));
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

  const initialized = await runConsumerCli(
    consumerRoot,
    ["init", "--name", "packed-cli-smoke"],
  );
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
    const tarballPath = await packCli(archiveRoot, cliManifest.version);
    await installTarball(consumerRoot, tarballPath);
    await verifyInstalledPackage(consumerRoot, cliManifest.version);
    await verifyConsumerCommands(consumerRoot, cliManifest.version);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  console.log(`Packed Lervo CLI 소비자 설치 검사 통과 (${cliManifest.version})`);
}

await main();
