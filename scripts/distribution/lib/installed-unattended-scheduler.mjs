import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function runCli(cli, root, args, env = process.env) {
  return execute(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  });
}

async function activateEventWriter(cli, root) {
  const evidence = await runCli(cli, root, ["event-contract", "evidence", "--json"]);
  const path = resolve(root, "event-reader-evidence.json");
  await writeFile(path, evidence.stdout, "utf8");
  const plan = JSON.parse(
    (await runCli(cli, root, ["event-contract", "activate", "--from", path, "--json"])).stdout,
  );
  await runCli(cli, root, [
    "event-contract",
    "activate",
    "--from",
    path,
    "--apply",
    plan.planId,
    "--json",
  ]);
}

async function startWorkstream(cli, root) {
  const path = resolve(root, "scheduler-workstream.json");
  await writeFile(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      status: "active",
      title: "Installed unattended scheduler fixture",
      objective: "Complete one queued assignment from one bounded scheduler invocation.",
      nextActions: ["Let the installed scheduler discover and execute the assignment."],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      updatedAt: "2026-09-07T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  const plan = JSON.parse(
    (await runCli(cli, root, ["workstream", "start", "--from", path, "--json"])).stdout,
  );
  await runCli(cli, root, [
    "workstream",
    "start",
    "--from",
    path,
    "--apply",
    plan.planId,
    "--json",
  ]);
  return JSON.parse(await readFile(resolve(root, ".lervo/state/workstreams/current.json"), "utf8"));
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

export async function verifyInstalledUnattendedScheduler(consumerRoot) {
  if (process.platform === "win32") {
    return { status: "skipped", reason: "The deterministic Codex executable shim is POSIX-only." };
  }
  const cli = resolve(consumerRoot, "node_modules/@lervo/cli/dist/bin.js");
  const root = resolve(consumerRoot, "installed-unattended-scheduler");
  const fakeBin = resolve(root, "fake-bin");
  const fakeCodex = resolve(fakeBin, "codex");
  const fixture = resolve(import.meta.dirname, "../fixtures/installed-capability-codex.mjs");
  const target = resolve(root, "src/result.ts");
  const promptLog = resolve(consumerRoot, "scheduler-codex-prompt.txt");
  const contextLog = resolve(consumerRoot, "scheduler-codex-context.jsonl");
  const debugLog = resolve(consumerRoot, "scheduler-codex-debug.txt");
  await Promise.all([
    mkdir(resolve(root, "src"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  await copyFile(fixture, fakeCodex);
  await chmod(fakeCodex, 0o755);
  await runCli(cli, root, ["init", "--minimal", "--name", "installed-unattended-scheduler"]);
  await activateEventWriter(cli, root);
  await writeFile(
    resolve(root, "AGENTS.md"),
    "Change only the assignment's declared paths.\n",
    "utf8",
  );
  await writeVerificationSuite(root);
  const workstream = await startWorkstream(cli, root);
  const worker = JSON.parse(
    (
      await runCli(cli, root, [
        "agent",
        "hire",
        "--role",
        "developer",
        "--provider",
        "codex",
        "--scope",
        "src",
        "--write",
        "--json",
      ])
    ).stdout,
  );
  const queued = JSON.parse(
    (
      await runCli(cli, root, [
        "assignment",
        "create",
        "--type",
        "implementation",
        "--role",
        "developer",
        "--criteria",
        "Create the installed scheduled result.",
        "--suite",
        "project.default",
        "--path",
        "src/result.ts",
        "--workstream",
        workstream.workstreamId,
        "--write",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(queued.status, "queued");
  const env = {
    ...process.env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    LERVO_INSTALLED_CAPABILITY_TARGET: target,
    LERVO_INSTALLED_CAPABILITY_PROMPT_LOG: promptLog,
    LERVO_INSTALLED_CAPABILITY_CONTEXT_LOG: contextLog,
    LERVO_INSTALLED_CAPABILITY_DEBUG_LOG: debugLog,
    LERVO_INSTALLED_CAPABILITY_CONTENT: "export const unattendedScheduler = true;\n",
    LERVO_INSTALLED_CAPABILITY_RESULT: "Installed unattended assignment complete.",
  };
  const scheduler = JSON.parse(
    (
      await runCli(
        cli,
        root,
        [
          "loop",
          "schedule",
          "--provider",
          "codex",
          "--agent",
          worker.agentId,
          "--poll-ms",
          "100",
          "--max-cycles",
          "2",
          "--max-claims",
          "1",
          "--max-runs",
          "1",
          "--runtime-ms",
          "60000",
          "--lease-ms",
          "300000",
          "--write",
          "--json",
        ],
        env,
      )
    ).stdout,
  );
  assert.equal(scheduler.status, "completed");
  assert.equal(scheduler.reasonCode, "work_complete");
  assert.deepEqual(scheduler.counts, {
    cycles: 2,
    claims: 1,
    managedRuns: 1,
    completedAssignments: 1,
    retryRuns: 0,
    recoverableRaces: 0,
    consecutiveFailures: 0,
  });
  const assignments = JSON.parse(
    (await runCli(cli, root, ["assignment", "list", "--json"])).stdout,
  ).assignments;
  assert.equal(assignments[0].assignmentId, queued.assignmentId);
  assert.equal(assignments[0].status, "completed");
  assert.equal(await readFile(target, "utf8"), "export const unattendedScheduler = true;\n");
  assert.match(await readFile(promptLog, "utf8"), /Create the installed scheduled result\./u);
  return { status: "passed", assignmentId: queued.assignmentId };
}
