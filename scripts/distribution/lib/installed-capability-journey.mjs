import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  installedPortableSkillInstructions,
  installedPortableSkillRequest,
  prepareInstalledPortableSkillCandidate,
} from "./installed-portable-skill-candidate.mjs";
import { observeInstalledPortableSkillTreatment } from "./installed-portable-skill-effect.mjs";
import {
  activateInstalledAgentProfileCandidate,
  rollbackInstalledAgentProfileCandidate,
} from "./installed-agent-profile-candidate.mjs";

const execute = promisify(execFile);

function bytes(value) {
  return new TextEncoder().encode(value);
}

async function runCli(cli, cwd, args, env = process.env) {
  return execute(process.execPath, [cli, ...args], {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  });
}

async function activateEventWriter(cli, root) {
  const evidence = await runCli(cli, root, ["event-contract", "evidence", "--json"]);
  const evidencePath = resolve(root, "event-reader-evidence.json");
  await writeFile(evidencePath, evidence.stdout, "utf8");
  const planned = await runCli(cli, root, [
    "event-contract",
    "activate",
    "--from",
    evidencePath,
    "--json",
  ]);
  const plan = JSON.parse(planned.stdout);
  const applied = await runCli(cli, root, [
    "event-contract",
    "activate",
    "--from",
    evidencePath,
    "--apply",
    plan.planId,
    "--json",
  ]);
  assert.equal(JSON.parse(applied.stdout).selectedEventSchemaVersion, 2);
}

async function installCapability(cli, root, source) {
  const planned = await runCli(cli, root, [
    "capability",
    "install",
    "--from",
    source,
    "--scope",
    "project",
    "--json",
  ]);
  const plan = JSON.parse(planned.stdout);
  const applied = await runCli(cli, root, [
    "capability",
    "install",
    "--from",
    source,
    "--scope",
    "project",
    "--apply",
    "--approval",
    plan.planHash,
    "--json",
  ]);
  return JSON.parse(applied.stdout);
}

async function createMcpPackage(root, hashCapabilityFiles) {
  await mkdir(root, { recursive: true });
  const configuration = "{}\n";
  const runtime = `${JSON.stringify({
    schemaVersion: 1,
    serverName: "installed-journey",
    transport: {
      kind: "stdio",
      command: "node",
      entrypointPath: "server.mjs",
      arguments: [],
      timeoutMs: 5000,
    },
  })}\n`;
  const server = "process.stdin.resume();\n";
  const contentHash = hashCapabilityFiles([
    { path: "configuration.schema.json", bytes: bytes(configuration) },
    { path: "lervo-mcp.json", bytes: bytes(runtime) },
    { path: "server.mjs", bytes: bytes(server) },
  ]);
  const manifest = {
    schemaVersion: 1,
    capabilityId: "repository/installed-mcp",
    kind: "mcp_server",
    version: "1.0.0",
    contentHash,
    source: {
      kind: "project",
      uri: "fixture:installed-mcp",
      publisher: { id: "lervo.acceptance", name: "Lervo acceptance" },
    },
    compatibility: {
      providers: { mode: "allowlist", providers: ["codex"] },
      minimumRuntimeVersion: "0.1.0",
      platforms: [process.platform],
    },
    requiredPermissions: ["filesystem.read", "shell.execute"],
    dependencies: [],
    entrypoint: {
      kind: "mcp_server",
      adapterId: "mcp.stdio",
      configurationSchemaRef: "configuration.schema.json",
      runtimeDescriptorPath: "lervo-mcp.json",
      credentialNames: [],
    },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  await Promise.all([
    writeFile(resolve(root, "configuration.schema.json"), configuration, "utf8"),
    writeFile(resolve(root, "lervo-mcp.json"), runtime, "utf8"),
    writeFile(resolve(root, "server.mjs"), server, "utf8"),
    writeFile(resolve(root, "lervo-capability.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  ]);
  return manifest;
}

function codexFixtureEntrypoint(fixture) {
  return `import(${JSON.stringify(pathToFileURL(fixture).href)}).catch((error) => { console.error(error); process.exitCode = 1; });\n`;
}

async function installCodexFixtureExecutable(root, fakeBin, fixture) {
  const executable = resolve(fakeBin, process.platform === "win32" ? "codex.exe" : "codex");
  if (process.platform === "win32") {
    const bootstrap = resolve(fakeBin, "codex-fixture-bootstrap.cjs");
    const entrypoint = codexFixtureEntrypoint(fixture);
    await Promise.all([
      copyFile(process.execPath, executable),
      writeFile(resolve(root, "app-server"), entrypoint, "utf8"),
      writeFile(
        bootstrap,
        [
          'const { existsSync, writeFileSync } = require("node:fs");',
          'const { basename, resolve } = require("node:path");',
          `const entrypoint = ${JSON.stringify(entrypoint)};`,
          'if (basename(process.execPath).toLowerCase() === "codex.exe") {',
          "  const path = resolve(process.argv[1]);",
          '  if (!existsSync(path)) writeFileSync(path, entrypoint, "utf8");',
          "}",
          "",
        ].join("\n"),
        "utf8",
      ),
    ]);
    return {
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${JSON.stringify(bootstrap)}`]
        .filter(Boolean)
        .join(" "),
    };
  } else {
    await copyFile(fixture, executable);
    await chmod(executable, 0o755);
  }
  return {};
}

function event(trace, type, capabilityId) {
  return trace.events.find(
    (item) =>
      item.type === type &&
      (capabilityId === undefined || item.payload.capabilityId === capabilityId),
  );
}

export async function verifyInstalledCapabilityJourney(consumerRoot, hashCapabilityFiles) {
  const cli = resolve(consumerRoot, "node_modules/@lervo/cli/dist/bin.js");
  const root = resolve(consumerRoot, "installed-capability-journey");
  const sources = resolve(root, "capability-sources");
  const mcpSource = resolve(sources, "mcp");
  const fakeBin = resolve(root, "fake-bin");
  const fixture = resolve(import.meta.dirname, "../fixtures/installed-capability-codex.mjs");
  const target = resolve(root, "src/result.ts");
  const promptLog = resolve(consumerRoot, "installed-capability-prompt.txt");
  const debugLog = resolve(consumerRoot, "installed-capability-debug.txt");
  await Promise.all([
    mkdir(resolve(root, "src"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  const codexFixtureEnvironment = await installCodexFixtureExecutable(root, fakeBin, fixture);
  await runCli(cli, root, [
    "init",
    "--minimal",
    "--name",
    "installed-capability-journey",
    "--json",
  ]);
  await activateEventWriter(cli, root);
  await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
  await writeFile(resolve(root, "AGENTS.md"), "Change only the declared file.\n", "utf8");
  await writeFile(
    resolve(root, ".lervo/verifications/project.default.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: project.default",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: verify-result",
      "    executable: node",
      "    arguments:",
      "      - -e",
      `      - ${JSON.stringify(
        "process.exit(require('node:fs').existsSync('src/result.ts') ? 0 : 1)",
      )}`,
      "    cwd: .",
      "    timeoutMs: 10000",
      "    maxOutputBytes: 4096",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
    "utf8",
  );
  const mcp = await createMcpPackage(mcpSource, hashCapabilityFiles);
  await installCapability(cli, root, mcpSource);
  const env = {
    ...process.env,
    ...codexFixtureEnvironment,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    LERVO_INSTALLED_CAPABILITY_TARGET: target,
    LERVO_INSTALLED_CAPABILITY_CHANGE_KIND: "update",
    LERVO_INSTALLED_CAPABILITY_PROMPT_LOG: promptLog,
    LERVO_INSTALLED_CAPABILITY_DEBUG_LOG: debugLog,
  };
  const skill = await prepareInstalledPortableSkillCandidate({
    cli,
    root,
    dependency: mcp,
    runCli,
    env,
  });
  const agentProfile = await activateInstalledAgentProfileCandidate({
    cli,
    root,
    runCli,
    roleProfileEvidence: skill.roleProfileEvidence,
  });
  let execution;
  try {
    execution = await runCli(
      cli,
      root,
      [
        "run",
        "--provider",
        "codex",
        "--path",
        "src/result.ts",
        "--capability",
        skill.manifest.capabilityId,
        "--verification",
        "project.default",
        "--json",
        installedPortableSkillRequest,
      ],
      env,
    );
  } catch (error) {
    const traced = await runCli(cli, root, ["trace", "last", "--full", "--json"]);
    const debug = await readFile(debugLog, "utf8").catch(() => "No fixture debug output.\n");
    error.message = `${error.message}\nFixture debug:\n${debug}\nInstalled capability trace:\n${traced.stdout}`;
    throw error;
  }
  assert.equal(execution.stderr, "");
  const outcome = JSON.parse(execution.stdout);
  assert.equal(outcome.verificationStatus, "passed");
  assert.equal(outcome.writingPublication.status, "allowed");
  assert.equal(outcome.writingPublication.content, "Installed capability journey complete.");
  assert.equal(outcome.resolvedSkills[0].trustStatus, "reviewed");
  assert.equal(outcome.activatedCapabilities[0].capabilityId, mcp.capabilityId);
  assert.equal(outcome.activatedCapabilities[0].evidence, "mcp_connected");
  assert.equal(await readFile(target, "utf8"), "export const installedCapabilityJourney = true;\n");
  const deliveredPrompt = await readFile(promptLog, "utf8");
  assert.ok(deliveredPrompt.includes(installedPortableSkillInstructions));
  assert.ok(deliveredPrompt.includes(skill.skill.contentHash));
  const traced = await runCli(cli, root, ["trace", outcome.runId, "--json"]);
  const trace = JSON.parse(traced.stdout);
  assert.equal(
    event(trace, "capability.recommended", skill.manifest.capabilityId).payload.queryDigest.length,
    71,
  );
  assert.equal(
    event(trace, "capability.selected", skill.manifest.capabilityId).payload.reason,
    "explicit",
  );
  assert.equal(event(trace, "capability.selected", mcp.capabilityId).payload.reason, "dependency");
  assert.equal(
    event(trace, "capability.activated", mcp.capabilityId).payload.evidence,
    "mcp_connected",
  );
  const completed = event(trace, "skill.completed");
  const runCompleted = event(trace, "run.completed");
  assert.equal(completed.payload.outputDigest, outcome.resultArtifact.contentHash);
  assert.equal(runCompleted.payload.resultDigest, outcome.resultArtifact.contentHash);
  assert.equal(runCompleted.payload.verificationStatus, "passed");
  const effect = await observeInstalledPortableSkillTreatment({
    cli,
    root,
    runCli,
    env,
    patternId: skill.patternId,
    ...skill.effect,
  });
  await rollbackInstalledAgentProfileCandidate({
    cli,
    root,
    runCli,
    patternId: agentProfile.patternId,
  });
  return {
    status: "passed",
    runId: outcome.runId,
    skillId: skill.skill.skillId,
    skillContentHash: skill.skill.contentHash,
    dependencyId: mcp.capabilityId,
    resultDigest: outcome.resultArtifact.contentHash,
    effect,
    agentProfilePatternId: agentProfile.patternId,
  };
}
