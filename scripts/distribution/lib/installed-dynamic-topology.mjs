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
  const path = resolve(root, "topology-workstream.json");
  await writeFile(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      status: "active",
      title: "Installed dynamic topology fixture",
      objective: "Materialize and execute one bounded branch-and-join graph.",
      nextActions: ["Apply the reviewed topology and execute every node."],
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
  return plan.snapshot.workstreamId;
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

function topologyNode(role, nodeKey, dependencyNodeKeys) {
  return {
    nodeKey,
    taskType: `installed.${nodeKey}`,
    roleId: role.roleId,
    roleVersion: role.version,
    roleContractHash: role.contractHash,
    requiredCapabilityHash: null,
    priority: 50,
    dependencyAssignmentIds: [],
    dependencyNodeKeys,
    acceptanceCriteria: [`Complete installed topology node ${nodeKey}.`],
    verificationSuiteIds: ["project.default"],
    approvalRequirements: [],
    expectedPaths: ["src/result.ts"],
  };
}

export async function verifyInstalledDynamicTopology(consumerRoot) {
  if (process.platform === "win32") {
    return { status: "skipped", reason: "The deterministic Codex executable shim is POSIX-only." };
  }
  const cli = resolve(consumerRoot, "node_modules/@lervo/cli/dist/bin.js");
  const root = resolve(consumerRoot, "installed-dynamic-topology");
  const fakeBin = resolve(root, "fake-bin");
  const fakeCodex = resolve(fakeBin, "codex");
  const fixture = resolve(import.meta.dirname, "../fixtures/installed-capability-codex.mjs");
  const target = resolve(root, "src/result.ts");
  await Promise.all([
    mkdir(resolve(root, "src"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  await copyFile(fixture, fakeCodex);
  await chmod(fakeCodex, 0o755);
  await runCli(cli, root, ["init", "--minimal", "--name", "installed-dynamic-topology"]);
  await activateEventWriter(cli, root);
  await writeFile(resolve(root, "AGENTS.md"), "Change only the assignment's declared paths.\n");
  await writeVerificationSuite(root);
  const workstreamId = await startWorkstream(cli, root);
  const role = JSON.parse(
    (await runCli(cli, root, ["role", "show", "--role", "developer", "--json"])).stdout,
  );
  const graph = JSON.parse(
    (await runCli(cli, root, ["assignment", "topology", "inspect", "--json"])).stdout,
  );
  const requestPath = resolve(root, "topology-request.json");
  await writeFile(
    requestPath,
    `${JSON.stringify({
      schemaVersion: 2,
      kind: "assignment_topology.change",
      workstreamId,
      expectedGraphHash: graph.graphHash,
      changeKey: "installed_branch_join",
      nodes: [
        topologyNode(role, "root", []),
        topologyNode(role, "left", ["root"]),
        topologyNode(role, "right", ["root"]),
        topologyNode(role, "join", ["left", "right"]),
      ],
    })}\n`,
    "utf8",
  );
  const topologyPlan = JSON.parse(
    (await runCli(cli, root, ["assignment", "topology", "change", "--from", requestPath, "--json"]))
      .stdout,
  ).plan;
  assert.equal(topologyPlan.status, "ready");
  const applied = JSON.parse(
    (
      await runCli(cli, root, [
        "assignment",
        "topology",
        "change",
        "--from",
        requestPath,
        "--apply",
        topologyPlan.planId,
        "--approval",
        topologyPlan.approvalHash,
        "--reviewer",
        "installed.acceptance",
        "--write",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(applied.receipt.status, "completed");
  assert.equal(applied.receipt.createdAssignmentIds.length, 4);
  const projected = JSON.parse(
    (await runCli(cli, root, ["assignment", "topology", "inspect", "--json"])).stdout,
  );
  assert.equal(projected.validity.status, "valid");
  assert.equal(projected.topologyHistory.status, "valid");
  assert.equal(projected.branchAssignmentIds.length, 1);
  assert.equal(projected.joinAssignmentIds.length, 1);
  await writeFile(target, "export const dynamicTopology = false;\n", "utf8");

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
  const baseEnv = {
    ...process.env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    LERVO_INSTALLED_CAPABILITY_TARGET: target,
    LERVO_INSTALLED_CAPABILITY_PROMPT_LOG: resolve(consumerRoot, "topology-codex-prompt.txt"),
    LERVO_INSTALLED_CAPABILITY_CONTEXT_LOG: resolve(consumerRoot, "topology-codex-context.jsonl"),
    LERVO_INSTALLED_CAPABILITY_DEBUG_LOG: resolve(consumerRoot, "topology-codex-debug.txt"),
    LERVO_INSTALLED_CAPABILITY_CHANGE_KIND: "update",
    LERVO_INSTALLED_CAPABILITY_RESULT: "Installed topology node complete.",
  };
  for (let index = 1; index <= 4; index += 1) {
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
          {
            ...baseEnv,
            LERVO_INSTALLED_CAPABILITY_CONTENT: `export const dynamicTopology = ${index};\n`,
          },
        )
      ).stdout,
    );
    assert.equal(scheduler.counts.completedAssignments, 1);
    assert.equal(scheduler.status, index === 4 ? "completed" : "paused");
    assert.equal(scheduler.reasonCode, index === 4 ? "work_complete" : "claim_limit");
  }
  const assignments = JSON.parse(
    (await runCli(cli, root, ["assignment", "list", "--json"])).stdout,
  ).assignments;
  assert.equal(
    assignments.every((assignment) => assignment.status === "completed"),
    true,
  );
  assert.equal(await readFile(target, "utf8"), "export const dynamicTopology = 4;\n");
  return { status: "passed", changeId: applied.receipt.changeId };
}
