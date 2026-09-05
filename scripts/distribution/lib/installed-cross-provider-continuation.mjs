import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const workstreamPath = ".lervo/state/workstreams/current.json";

async function runCli(cli, cwd, args, env = process.env) {
  return execute(process.execPath, [cli, ...args], {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  });
}

function runCliWithInput(cli, cwd, args, input, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`The installed CLI timed out: ${args.join(" ")}`));
    }, 120_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(Object.assign(new Error(stderr || stdout), { code, stdout, stderr }));
    });
    child.stdin.end(input);
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

async function applyWorkstream(cli, root, action, snapshot, provider) {
  const input = JSON.stringify(snapshot);
  const planned = await runCliWithInput(
    cli,
    root,
    ["workstream", action, "--stdin", "--actor", "agent", "--provider", provider, "--json"],
    input,
  );
  const plan = JSON.parse(planned.stdout);
  await runCliWithInput(
    cli,
    root,
    [
      "workstream",
      action,
      "--stdin",
      "--actor",
      "agent",
      "--provider",
      provider,
      "--apply",
      plan.planId,
    ],
    input,
  );
}

function traceEvent(trace, runId, type) {
  return trace.events.find((event) => event.runId === runId && event.type === type);
}

function managedDocumentFromCodexLog(log, path) {
  for (const line of log.trim().split("\n")) {
    if (line === "") continue;
    for (const item of JSON.parse(line)) {
      const text = item.content?.[0]?.text;
      if (typeof text !== "string") continue;
      const document = JSON.parse(text).document;
      if (document?.path === path) return document;
    }
  }
  throw new Error(`Codex did not receive ${path}.`);
}

function managedDocumentFromClaudeLog(log, path) {
  for (const line of log.trim().split("\n")) {
    if (line === "") continue;
    const content = JSON.parse(line);
    const documents = JSON.parse(content).documents;
    const document = documents?.find((candidate) => candidate.path === path);
    if (document !== undefined) return document;
  }
  throw new Error(`Claude did not receive ${path}.`);
}

async function writeVerificationSuite(root) {
  await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
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
}

export async function verifyInstalledCrossProviderContinuation(
  consumerRoot,
  nativeClaudeExecutable,
) {
  if (process.platform === "win32") {
    return { status: "skipped", reason: "The deterministic native executable shim is POSIX-only." };
  }
  const cli = resolve(consumerRoot, "node_modules/@lervo/cli/dist/bin.js");
  const root = resolve(consumerRoot, "installed-cross-provider-continuation");
  const fakeBin = resolve(root, "fake-bin");
  const fakeCodex = resolve(fakeBin, "codex");
  const codexFixture = resolve(import.meta.dirname, "../fixtures/installed-capability-codex.mjs");
  const claudeFixture = resolve(
    import.meta.dirname,
    "../fixtures/installed-continuation-claude.mjs",
  );
  const target = resolve(root, "src/result.ts");
  const codexPromptLog = resolve(consumerRoot, "continuation-codex-prompt.jsonl");
  const codexContextLog = resolve(consumerRoot, "continuation-codex-context.jsonl");
  const claudePromptLog = resolve(consumerRoot, "continuation-claude-prompt.jsonl");
  const claudeContextLog = resolve(consumerRoot, "continuation-claude-context.jsonl");
  const debugLog = resolve(consumerRoot, "continuation-fixture-debug.log");
  await Promise.all([
    mkdir(resolve(root, "src"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  await copyFile(codexFixture, fakeCodex);
  await chmod(fakeCodex, 0o755);
  const initialized = await runCli(cli, root, [
    "init",
    "--minimal",
    "--name",
    "installed-cross-provider-continuation",
    "--json",
  ]);
  const projectId = JSON.parse(initialized.stdout).result.projectManifest.projectId;
  await activateEventWriter(cli, root);
  await writeFile(resolve(root, "AGENTS.md"), "Change only the declared file.\n", "utf8");
  await writeVerificationSuite(root);
  await applyWorkstream(
    cli,
    root,
    "start",
    {
      schemaVersion: 1,
      status: "active",
      title: "Installed cross-provider continuation fixture",
      objective: "Create an initial result and refine it in a fresh provider session.",
      nextActions: ["Codex creates the initial result.", "Claude resumes and refines it."],
      blockers: [],
      notes: [],
      references: [],
      updatedAt: "2026-09-05T00:01:00.000Z",
    },
    "codex",
  );
  const firstWorkstreamBytes = await readFile(resolve(root, workstreamPath), "utf8");
  const firstWorkstream = JSON.parse(firstWorkstreamBytes);
  const codexEnv = {
    ...process.env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    LERVO_INSTALLED_CAPABILITY_TARGET: target,
    LERVO_INSTALLED_CAPABILITY_PROMPT_LOG: codexPromptLog,
    LERVO_INSTALLED_CAPABILITY_CONTEXT_LOG: codexContextLog,
    LERVO_INSTALLED_CAPABILITY_DEBUG_LOG: debugLog,
    LERVO_INSTALLED_CAPABILITY_CONTENT: 'export const continuedBy = "codex";\n',
    LERVO_INSTALLED_CAPABILITY_RESULT: "Installed Codex checkpoint complete.",
  };
  const initial = JSON.parse(
    (
      await runCli(
        cli,
        root,
        [
          "run",
          "--provider",
          "codex",
          "--path",
          "src/result.ts",
          "--verification",
          "project.default",
          "--json",
          "Create the initial result for the current workstream",
        ],
        codexEnv,
      )
    ).stdout,
  );
  const codexDocument = managedDocumentFromCodexLog(
    await readFile(codexContextLog, "utf8"),
    workstreamPath,
  );
  assert.equal(codexDocument.content, firstWorkstreamBytes);
  assert.equal(await readFile(target, "utf8"), 'export const continuedBy = "codex";\n');
  await applyWorkstream(
    cli,
    root,
    "update",
    {
      ...firstWorkstream,
      revision: 2,
      nextActions: ["Claude resumes and refines the verified initial result."],
      notes: [`Codex completed ${initial.resultArtifact.contentHash}.`],
      updatedAt: "2026-09-05T00:02:00.000Z",
    },
    "codex",
  );
  const continuationBytes = await readFile(resolve(root, workstreamPath), "utf8");
  const tampered = JSON.parse(continuationBytes);
  tampered.notes = ["This projection no longer matches its recorded snapshot."];
  await writeFile(resolve(root, workstreamPath), `${JSON.stringify(tampered)}\n`, "utf8");
  await copyFile(claudeFixture, nativeClaudeExecutable);
  await chmod(nativeClaudeExecutable, 0o755);
  const claudeEnv = {
    ...process.env,
    LERVO_INSTALLED_CONTINUATION_TARGET: target,
    LERVO_INSTALLED_CONTINUATION_CLAUDE_PROMPT_LOG: claudePromptLog,
    LERVO_INSTALLED_CONTINUATION_CLAUDE_CONTEXT_LOG: claudeContextLog,
    LERVO_INSTALLED_CONTINUATION_DEBUG_LOG: debugLog,
  };
  await assert.rejects(
    runCli(
      cli,
      root,
      [
        "run",
        "--provider",
        "claude",
        "--path",
        "src/result.ts",
        "--verification",
        "project.default",
        "--json",
        "Resume the current workstream",
      ],
      claudeEnv,
    ),
    /workstream|snapshot/iu,
  );
  await writeFile(resolve(root, workstreamPath), continuationBytes, "utf8");
  let resumedOutput;
  try {
    resumedOutput = await runCli(
      cli,
      root,
      [
        "run",
        "--provider",
        "claude",
        "--path",
        "src/result.ts",
        "--verification",
        "project.default",
        "--json",
        "Resume the current workstream in this fresh provider session",
      ],
      claudeEnv,
    );
  } catch (error) {
    const debug = await readFile(debugLog, "utf8").catch(() => "No fixture debug output.\n");
    error.message = `${error.message}\nFixture debug:\n${debug}`;
    throw error;
  }
  const resumed = JSON.parse(resumedOutput.stdout);
  const claudeDocument = managedDocumentFromClaudeLog(
    await readFile(claudeContextLog, "utf8"),
    workstreamPath,
  );
  assert.equal(claudeDocument.content, continuationBytes);
  assert.equal(JSON.parse(claudeDocument.content).workstreamId, firstWorkstream.workstreamId);
  assert.equal(JSON.parse(claudeDocument.content).revision, 2);
  assert.notEqual(claudeDocument.contentHash, codexDocument.contentHash);
  assert.notEqual(initial.runId, resumed.runId);
  assert.notEqual(initial.sessionId, resumed.sessionId);
  assert.equal(await readFile(target, "utf8"), 'export const continuedBy = "claude";\n');
  assert.equal(initial.verificationStatus, "passed");
  assert.equal(resumed.verificationStatus, "passed");
  assert.equal(initial.writingPublication.status, "allowed");
  assert.equal(resumed.writingPublication.status, "allowed");
  const traces = [];
  for (const [outcome, document] of [
    [initial, codexDocument],
    [resumed, claudeDocument],
  ]) {
    const trace = JSON.parse(
      (await runCli(cli, root, ["trace", outcome.runId, "--full", "--json"])).stdout,
    );
    traces.push(trace);
    assert.equal(
      traceEvent(trace, outcome.runId, "work.causality.recorded").payload.workstreamId,
      firstWorkstream.workstreamId,
    );
    assert.equal(
      trace.events.find(
        (event) =>
          event.runId === outcome.runId &&
          event.type === "document.loaded" &&
          event.payload.documentId === document.documentId,
      ).payload.contentHash,
      document.contentHash,
    );
    assert.ok(
      traceEvent(trace, outcome.runId, "context.injected").payload.documentIds.includes(
        document.documentId,
      ),
    );
    assert.equal(
      traceEvent(trace, outcome.runId, "run.completed").payload.resultDigest,
      outcome.resultArtifact.contentHash,
    );
  }
  const providerSessionIds = traces.map(
    (trace) =>
      trace.events.find((event) => event.type === "adapter.started").payload.providerSessionId,
  );
  assert.equal(providerSessionIds.length, 2);
  assert.notEqual(providerSessionIds[0], providerSessionIds[1]);
  return {
    status: "passed",
    projectId,
    workstreamId: firstWorkstream.workstreamId,
    initialRunId: initial.runId,
    resumedRunId: resumed.runId,
  };
}
