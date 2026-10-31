import { verifyCliNativeArtifact } from "./lib/cli-native-artifact.mjs";
import { cliGraphPackageFiles } from "../shared/cli-release-files.mjs";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  deployBuiltCli,
  importBuiltWorkspacePackage,
  readJson,
  repositoryRoot,
  runInstalledCli,
} from "./lib/installed-cli.mjs";

const cliManifestPath = resolve(repositoryRoot, "apps/cli/package.json");
const execFileAsync = promisify(execFile);

function runShell(command, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("/bin/sh", ["-c", command], options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end("{}\n");
  });
}

async function readExpectedManifest() {
  const cliManifest = await readJson(cliManifestPath);
  assert.deepEqual(cliManifest.bin, {
    lervo: "./dist/bin.js",
    "lervo-node": "./dist/node-runtime.js",
  });
  return cliManifest;
}

async function verifyInstalledIdentity(cliEntry, deploymentRoot, projectRoot, expectedManifest) {
  const deployedManifest = await readJson(resolve(deploymentRoot, "package.json"));
  await verifyCliNativeArtifact(deploymentRoot, { smoke: true });
  assert.equal(deployedManifest.name, expectedManifest.name);
  assert.equal(deployedManifest.version, expectedManifest.version);
  assert.equal(
    deployedManifest.description,
    "Lervo CLI for managing AI agent execution and evidence in local repositories",
  );
  assert.deepEqual(deployedManifest.keywords, ["ai-agents", "local-first", "orchestration"]);
  assert.equal(deployedManifest.license, expectedManifest.license);
  assert.deepEqual(deployedManifest.repository, expectedManifest.repository);
  assert.deepEqual(deployedManifest.publishConfig, expectedManifest.publishConfig);
  assert.equal(deployedManifest.private, false);
  assert.deepEqual(deployedManifest.engines, { node: ">=22.13" });
  assert.deepEqual(deployedManifest.bin, {
    lervo: "./dist/bin.js",
    "lervo-node": "./dist/node-runtime.js",
  });
  assert.deepEqual(deployedManifest.files, cliGraphPackageFiles);
  assert.deepEqual(Object.keys(deployedManifest.dependencies).sort(), [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sdk",
    "@modelcontextprotocol/sdk",
    "zod",
  ]);
  assert.match(
    deployedManifest.dependencies["@anthropic-ai/claude-agent-sdk"],
    /^0\.3\.226(?:\(|$)/,
  );
  assert.match(deployedManifest.dependencies["@anthropic-ai/sdk"], /^0\.117\.1(?:\(|$)/);
  assert.match(deployedManifest.dependencies["@modelcontextprotocol/sdk"], /^1\.30\.0(?:\(|$)/);
  assert.match(deployedManifest.dependencies.zod, /^4\.4\.3(?:\(|$)/);
  await assert.rejects(access(resolve(deploymentRoot, "node_modules/@lervo")), { code: "ENOENT" });
  const guide = await readFile(resolve(deploymentRoot, "README.md"), "utf8");
  assert.equal(guide.includes("npm install --global @lervo/cli"), true);
  assert.equal(guide.includes("lervo init --name my-project"), true);
  const terminalHook = await readFile(resolve(deploymentRoot, "dist/terminal-hook.js"), "utf8");
  assert.equal(terminalHook.startsWith("#!/usr/bin/env node\n"), true);
  const nodeRuntime = await readFile(resolve(deploymentRoot, "dist/node-runtime.js"), "utf8");
  assert.equal(nodeRuntime.startsWith("#!/usr/bin/env node\n"), true);

  const version = await runInstalledCli(cliEntry, ["--version"], projectRoot);
  assert.equal(version.stdout, `lervo ${expectedManifest.version}\n`);
  assert.equal(version.stderr, "");
}

async function verifyTraceCapabilities(cliEntry, projectRoot, diagnostics) {
  const capabilities = await runInstalledCli(cliEntry, ["trace", "--capabilities"], projectRoot);
  assert.equal(capabilities.stderr, "");
  const report = diagnostics.readTraceCapabilitiesReport(JSON.parse(capabilities.stdout));
  assert.equal(report.defaultMode, "page");
  assert.equal(report.modes.find(({ mode }) => mode === "page")?.explicit, false);
  assert.deepEqual(report.deprecations, []);
}

function appendTraceFixture(storage) {
  const common = {
    projectId: storage.manifest.projectId,
    runId: "run_built_cli_smoke_0001",
    sessionId: "ses_built_cli_smoke_0001",
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  storage.events.append({
    ...common,
    eventId: "evt_built_cli_smoke_start",
    type: "run.requested",
    occurredAt: "2026-08-20T00:00:00Z",
    payload: {
      requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      role: "developer",
      risk: "low",
    },
  });
  storage.events.append({
    ...common,
    eventId: "evt_built_cli_smoke_done",
    type: "run.completed",
    occurredAt: "2026-08-20T00:00:01Z",
    payload: {
      resultDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      artifactIds: ["art_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
      verificationStatus: "not_run",
    },
  });
}

async function createTraceFixture(cliEntry, projectRoot, openProjectStorage) {
  const initialized = await runInstalledCli(
    cliEntry,
    ["init", "--name", "installed-cli-smoke"],
    projectRoot,
  );
  assert.equal(initialized.stderr, "");

  const storage = await openProjectStorage(projectRoot);
  try {
    appendTraceFixture(storage);
  } finally {
    await storage.close();
  }
}

async function verifyTraceModes(cliEntry, projectRoot, diagnostics) {
  const defaultTrace = await runInstalledCli(cliEntry, ["trace", "last", "--json"], projectRoot);
  assert.equal(defaultTrace.stderr, "");
  const pageReport = diagnostics.readTracePageReport(JSON.parse(defaultTrace.stdout));
  assert.equal(pageReport.page.returnedCount, 2);
  assert.equal(pageReport.page.hasMore, false);
  assert.equal(Object.hasOwn(pageReport, "status"), false);

  const fullTrace = await runInstalledCli(
    cliEntry,
    ["trace", "last", "--full", "--json"],
    projectRoot,
  );
  assert.equal(fullTrace.stderr, "");
  const fullReport = diagnostics.readTraceReport(JSON.parse(fullTrace.stdout));
  assert.equal(fullReport.status, "completed");
  assert.deepEqual(fullReport.events, pageReport.events);
}

async function verifySelfContainedTerminalHook(deploymentRoot, projectRoot, repositoryKnowledge) {
  const runtimeContent = await readFile(
    resolve(deploymentRoot, "dist/terminal-hook-launcher.mjs"),
    "utf8",
  );
  assert.ok(Buffer.byteLength(runtimeContent) <= 16 * 1024);
  assert.equal(
    runtimeContent,
    await readFile(resolve(repositoryRoot, "apps/cli/src/terminal-hook-launcher.mjs"), "utf8"),
  );
  const plan = await repositoryKnowledge.createTerminalIntegrationPlan(projectRoot, runtimeContent);
  assert.equal(plan.status, "review_required");
  await repositoryKnowledge.applyTerminalIntegrationPlan({
    plan,
    runtimeContent,
    approvedOperationId: plan.operationId,
    approvedHash: plan.approvalHash,
    now: new Date("2026-08-20T00:00:02Z"),
    recordApplied: () => undefined,
  });
  await execFileAsync("git", ["init", "--quiet"], { cwd: projectRoot });
  const nested = resolve(projectRoot, "nested/source");
  await mkdir(nested, { recursive: true });
  const command = repositoryKnowledge.terminalHookCommand("codex");
  assert.equal(command.includes("lervo terminal hook"), false);
  const environment = { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  assert.deepEqual(await runShell(command, { cwd: nested, env: environment }), {
    code: 2,
    stdout: "",
    stderr:
      "Lervo terminal integration failed closed without exposing prompt or provider configuration content.\n",
  });
  const store = repositoryKnowledge.terminalHookRuntimeStorePath();
  const pointer = JSON.parse(await readFile(resolve(store, "current.json"), "utf8"));
  assert.ok(pointer);
  await appendFile(resolve(store, pointer.directory, "runtime-v2.mjs"), "// tampered\n");
  assert.deepEqual(await runShell(command, { cwd: nested, env: environment }), {
    code: 2,
    stdout: "",
    stderr: "Lervo terminal hook runtime integrity verification failed.\n",
  });
}

async function main() {
  const expectedManifest = await readExpectedManifest();

  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-installed-cli-"));
  // Every CLI the smoke check starts inherits this, so it never registers its fixture in the
  // host's repository registry or touches other user state (ADR-0470).
  process.env.LERVO_USER_STATE_DIRECTORY = resolve(fixtureRoot, "user-state");
  process.env.HOME = resolve(fixtureRoot, "home");
  process.env.USERPROFILE = process.env.HOME;
  process.env.LOCALAPPDATA = resolve(fixtureRoot, "local");
  try {
    const deploymentRoot = resolve(fixtureRoot, "installation");
    const projectRoot = resolve(fixtureRoot, "project");
    await deployBuiltCli(deploymentRoot);
    await mkdir(projectRoot);

    const cliEntry = resolve(deploymentRoot, "dist/bin.js");
    const [diagnostics, { openProjectStorage }, repositoryKnowledge] = await Promise.all([
      importBuiltWorkspacePackage("diagnostics"),
      importBuiltWorkspacePackage("project-storage"),
      importBuiltWorkspacePackage("repository-knowledge"),
    ]);
    await verifyInstalledIdentity(cliEntry, deploymentRoot, projectRoot, expectedManifest);
    await verifyTraceCapabilities(cliEntry, projectRoot, diagnostics);
    await createTraceFixture(cliEntry, projectRoot, openProjectStorage);
    await verifyTraceModes(cliEntry, projectRoot, diagnostics);
    await verifySelfContainedTerminalHook(deploymentRoot, projectRoot, repositoryKnowledge);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  console.log(`Installed Lervo CLI smoke check passed (${expectedManifest.version})`);
}

await main();
