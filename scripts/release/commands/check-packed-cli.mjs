import { verifyCliNativeArtifact } from "../../distribution/lib/cli-native-artifact.mjs";
import { readRuntimeModuleArtifact } from "../../../packages/runtime-security/dist/index.js";
import {
  cliGraphPackageFiles,
  cliReleaseFilesForSchema,
  currentCliReleaseSchemaVersion,
} from "../../shared/cli-release-files.mjs";
import { verifyInstalledContextQuality } from "../../distribution/lib/installed-context-quality.mjs";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  importBuiltWorkspacePackage,
  readJson,
  repositoryRoot,
  runPnpm,
  runPnpmWithInput,
} from "../../distribution/lib/installed-cli.mjs";
import { verifyInstalledClaudeNativeRuntime } from "../../distribution/lib/claude-native-runtime.mjs";
import {
  createMixedEventReaderFixture,
  installMixedEventReaderFixture,
} from "../../distribution/lib/mixed-event-reader-fixture.mjs";
import { packCliArtifact } from "../../distribution/lib/packed-cli-artifact.mjs";
import { parseSmokeTarballSource, smokeTarball } from "../lib/smoke-tarball-source.mjs";
import { verifyPackedOperatingConsumer } from "../../distribution/lib/packed-operating-consumer.mjs";
import { verifyInstalledCapabilityJourney } from "../../distribution/lib/installed-capability-journey.mjs";
import { verifyInstalledCrossProviderContinuation } from "../../distribution/lib/installed-cross-provider-continuation.mjs";

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
  await verifyCliNativeArtifact(packageRoot, { smoke: true });
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
  assert.deepEqual(manifest.files, cliGraphPackageFiles);
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
  const runtime = await readRuntimeModuleArtifact(resolve(packageRoot, "dist"));
  const cliReleaseFiles = cliReleaseFilesForSchema(
    currentCliReleaseSchemaVersion,
    [...runtime.files.keys()]
      .filter((name) => name !== "repository-runtime.json")
      .map((name) => `dist/${name}`),
  );
  assert.deepEqual(await collectFiles(packageRoot), [...cliReleaseFiles, "package.json"]);
  assert.deepEqual((await readdir(resolve(consumerRoot, "node_modules/@lervo"))).sort(), ["cli"]);

  const entry = await readFile(resolve(packageRoot, "dist/bin.js"), "utf8");
  assert.equal(entry.startsWith("#!/usr/bin/env node\n"), true);
  const launcher = await readFile(resolve(packageRoot, "dist/terminal-hook-launcher.mjs"), "utf8");
  assert.equal(launcher.startsWith("#!/usr/bin/env node\n"), true);
  assert.ok(Buffer.byteLength(launcher) <= 16 * 1024);
  assert.equal(launcher.includes(manifest.version), false);
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
    ["Prerequisites", "Install", "First run"],
  );
  for (const requiredText of [
    "npm install --global @lervo/cli",
    "lervo init --name my-project",
    "lervo init --dry-run --name my-project",
    "lervo --help",
  ]) {
    assert.equal(guide.includes(requiredText), true);
  }
  assert.match(guide, /\bNode\.js 22\.13(?:\+| or (?:later|newer))(?:\.|\s|$)/u);
  assert.match(
    guide,
    /\b(?:works?(?: locally)?|operates?|runs?) without a Hub\b|\bdo(?:es)? not require a Hub\b|\brequires? no Hub\b/u,
  );
  assert.match(guide, /[Pp]rovider(?: configuration is separate| separately)/u);
}

async function runConsumerCli(consumerRoot, args, input) {
  return input === undefined
    ? runPnpm(["exec", "lervo", ...args], { cwd: consumerRoot })
    : runPnpmWithInput(["exec", "lervo", ...args], input, { cwd: consumerRoot });
}

async function verifyConsumerCommands(consumerRoot, expectedVersion, eventContract) {
  const version = await runConsumerCli(consumerRoot, ["--version"]);
  assert.equal(version.stdout, `lervo ${expectedVersion}\n`);
  assert.equal(version.stderr, "");

  const capabilities = await runConsumerCli(consumerRoot, ["trace", "--capabilities"]);
  assert.equal(capabilities.stderr, "");
  const report = JSON.parse(capabilities.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.defaultMode, "page");
  assert.deepEqual(report.deprecations, []);
  assert.deepEqual(report.eventReader, {
    schemaVersion: 1,
    capability: "event_reader",
    readableEventSchemaVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  });

  const initialized = await runConsumerCli(consumerRoot, [
    "init",
    "--minimal",
    "--name",
    "packed-cli-smoke",
  ]);
  assert.equal(initialized.stderr, "");
  await access(resolve(consumerRoot, ".lervo/project.yaml"));
  const projectId = /projectId: (prj_[A-Za-z0-9_-]+)\n/u.exec(initialized.stdout)?.[1];
  assert.notEqual(projectId, undefined);

  const state = await runConsumerCli(consumerRoot, ["state", "status", "--json"]);
  assert.equal(state.stderr, "");
  const defaultWriter = await runConsumerCli(consumerRoot, ["event-contract", "status", "--json"]);
  assert.equal(defaultWriter.stderr, "");
  assert.equal(JSON.parse(defaultWriter.stdout).coordinate.selectedEventSchemaVersion, 1);
  const evidence = await runConsumerCli(consumerRoot, ["event-contract", "evidence", "--json"]);
  assert.equal(evidence.stderr, "");
  await writeFile(resolve(consumerRoot, "event-reader-evidence.json"), evidence.stdout, "utf8");
  const activation = await runConsumerCli(consumerRoot, [
    "event-contract",
    "activate",
    "--from",
    "event-reader-evidence.json",
    "--json",
  ]);
  assert.equal(activation.stderr, "");
  const activationPlan = JSON.parse(activation.stdout);
  assert.equal(activationPlan.status, "ready");
  const applied = await runConsumerCli(consumerRoot, [
    "event-contract",
    "activate",
    "--from",
    "event-reader-evidence.json",
    "--apply",
    activationPlan.planId,
    "--json",
  ]);
  assert.equal(applied.stderr, "");
  assert.equal(JSON.parse(applied.stdout).selectedEventSchemaVersion, 2);
  const rollback = await runConsumerCli(consumerRoot, ["event-contract", "rollback", "--json"]);
  assert.equal(rollback.stderr, "");
  const rollbackPlan = JSON.parse(rollback.stdout);
  assert.equal(rollbackPlan.status, "ready");
  const rolledBack = await runConsumerCli(consumerRoot, [
    "event-contract",
    "rollback",
    "--apply",
    rollbackPlan.planId,
    "--json",
  ]);
  assert.equal(rolledBack.stderr, "");
  assert.equal(JSON.parse(rolledBack.stdout).selectedEventSchemaVersion, 1);
  const events = createMixedEventReaderFixture(projectId, eventContract.computeEventHash);
  installMixedEventReaderFixture(resolve(consumerRoot, ".lervo/data/events.sqlite"), events);
  const trace = await runConsumerCli(consumerRoot, [
    "trace",
    "run_packed_reader_proof_01",
    "--json",
  ]);
  assert.equal(trace.stderr, "");
  const traceReport = JSON.parse(trace.stdout);
  assert.deepEqual(traceReport.events, events);
  assert.deepEqual(
    traceReport.events.map((event) => event.schemaVersion),
    [1, 2],
  );

  return verifyPackedOperatingConsumer(consumerRoot, (args, input) =>
    runConsumerCli(consumerRoot, args, input),
  );
}

async function main() {
  const cliManifest = await readJson(cliManifestPath);
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-packed-cli-"));
  try {
    const archiveRoot = resolve(fixtureRoot, "archive");
    const consumerRoot = resolve(fixtureRoot, "consumer");
    await Promise.all([mkdir(archiveRoot), mkdir(consumerRoot)]);
    const tarballPath = await smokeTarball({
      archiveRoot,
      version: cliManifest.version,
      releaseSubjects: parseSmokeTarballSource(process.argv.slice(2)).releaseSubjects,
      pack: packCliArtifact,
    });
    await installTarball(consumerRoot, tarballPath);
    await verifyInstalledPackage(consumerRoot, cliManifest);
    await verifyPackageGuide(consumerRoot);
    const nativeRuntime = await verifyInstalledClaudeNativeRuntime(consumerRoot);
    const eventContract = await importBuiltWorkspacePackage("event-contract");
    const capabilities = await importBuiltWorkspacePackage("capabilities");
    const operating = await verifyConsumerCommands(
      consumerRoot,
      cliManifest.version,
      eventContract,
    );
    const contextQuality = await verifyInstalledContextQuality(consumerRoot);
    const capabilityJourney = await verifyInstalledCapabilityJourney(
      consumerRoot,
      capabilities.hashCapabilityFiles,
    );
    const continuation = await verifyInstalledCrossProviderContinuation(
      consumerRoot,
      nativeRuntime.executable,
    );
    console.log(
      `Installed context quality verified: ${contextQuality.preparedEventId} / ${contextQuality.verifiedEventId}`,
    );
    console.log(`Claude native runtime verified: ${nativeRuntime.packageName}`);
    console.log(`Installed capability journey verified: ${capabilityJourney.runId}`);
    console.log(
      continuation.status === "passed"
        ? `Installed cross-provider continuation verified: ${continuation.initialRunId} -> ${continuation.resumedRunId}`
        : `Installed cross-provider continuation skipped: ${continuation.reason}`,
    );
    console.log(
      `Packed operating journey verified: ${operating.assignmentId} handed off as ${operating.handoffId}`,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  console.log(`Packed Lervo CLI consumer installation check passed (${cliManifest.version})`);
}

await main();
