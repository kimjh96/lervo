import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const cliManifestPath = resolve(repositoryRoot, "apps/cli/package.json");
const rootManifestPath = resolve(repositoryRoot, "package.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runInstalledCli(cliEntry, args, cwd) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliEntry, ...args],
    { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  return { stdout, stderr };
}

async function deployBuiltCli(target) {
  const args = [
    "--offline",
    "--config.inject-workspace-packages=true",
    "--filter",
    "@lervo/cli",
    "deploy",
    "--prod",
    target,
  ];
  if (process.env.npm_execpath) {
    await execFileAsync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return;
  }
  await execFileAsync("pnpm", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function readExpectedVersion() {
  const [rootManifest, cliManifest] = await Promise.all([
    readJson(rootManifestPath),
    readJson(cliManifestPath),
  ]);
  assert.equal(cliManifest.version, rootManifest.version);
  assert.deepEqual(cliManifest.bin, { lervo: "./dist/bin.js" });
  return rootManifest.version;
}

async function importInstalledPackage(deploymentRoot, packageName) {
  return import(pathToFileURL(
    resolve(deploymentRoot, `node_modules/@lervo/${packageName}/dist/index.js`),
  ).href);
}

async function verifyInstalledIdentity(cliEntry, deploymentRoot, projectRoot, expectedVersion) {
  const deployedManifest = await readJson(resolve(deploymentRoot, "package.json"));
  assert.equal(deployedManifest.version, expectedVersion);
  assert.deepEqual(deployedManifest.bin, { lervo: "./dist/bin.js" });

  const version = await runInstalledCli(cliEntry, ["--version"], projectRoot);
  assert.equal(version.stdout, `lervo ${expectedVersion}\n`);
  assert.equal(version.stderr, "");
}

async function verifyTraceCapabilities(cliEntry, projectRoot, diagnostics) {
  const capabilities = await runInstalledCli(
    cliEntry,
    ["trace", "--capabilities"],
    projectRoot,
  );
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
  const defaultTrace = await runInstalledCli(
    cliEntry,
    ["trace", "last", "--json"],
    projectRoot,
  );
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

async function main() {
  const expectedVersion = await readExpectedVersion();

  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-installed-cli-"));
  try {
    const deploymentRoot = resolve(fixtureRoot, "installation");
    const projectRoot = resolve(fixtureRoot, "project");
    await deployBuiltCli(deploymentRoot);
    await mkdir(projectRoot);

    const cliEntry = resolve(deploymentRoot, "dist/bin.js");
    const [diagnostics, { openProjectStorage }] = await Promise.all([
      importInstalledPackage(deploymentRoot, "diagnostics"),
      importInstalledPackage(deploymentRoot, "project-storage"),
    ]);
    await verifyInstalledIdentity(
      cliEntry,
      deploymentRoot,
      projectRoot,
      expectedVersion,
    );
    await verifyTraceCapabilities(cliEntry, projectRoot, diagnostics);
    await createTraceFixture(cliEntry, projectRoot, openProjectStorage);
    await verifyTraceModes(cliEntry, projectRoot, diagnostics);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  console.log(`설치된 Lervo CLI smoke 검사 통과 (${expectedVersion})`);
}

await main();
