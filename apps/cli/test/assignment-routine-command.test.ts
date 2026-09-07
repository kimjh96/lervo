import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { listAssignments } from "@lervo/agent-workforce";
import type { AssignmentRoutineRequestV1 } from "@lervo/application-contract";
import { resolveRoleContract } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function outputIo(root: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd: root,
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
  };
}

async function activeWorkstream(root: string): Promise<string> {
  const draft = JSON.stringify({
    schemaVersion: 1,
    status: "active",
    title: "Routine materialization",
    objective: "Materialize one exact assignment graph.",
    nextActions: [],
    blockers: [],
    notes: [],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: new Date().toISOString(),
  });
  const planned = outputIo(root);
  expect(
    await runCli(["workstream", "start", "--stdin", "--json"], {
      ...planned.io,
      stdin: async () => draft,
    }),
  ).toBe(0);
  const plan = JSON.parse(planned.stdout.join("")) as {
    planId: string;
    snapshot: { workstreamId: string };
  };
  expect(
    await runCli(["workstream", "start", "--stdin", "--apply", plan.planId], {
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
      stdin: async () => draft,
    }),
  ).toBe(0);
  return plan.snapshot.workstreamId;
}

describe("assignment routine command", () => {
  it("plans, stale-checks, materializes, and replays an exact local routine", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-assignment-routine-"));
    roots.push(root);
    const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
    expect(await runCli(["init"], quiet)).toBe(0);
    const workstreamId = await activeWorkstream(root);
    const contract = await resolveRoleContract(root, "developer");
    const request: AssignmentRoutineRequestV1 = {
      schemaVersion: 1,
      workstreamId,
      template: {
        schemaVersion: 1,
        routineId: "change.review",
        templateVersion: "1.0.0",
        concurrency: { mode: "enqueue_bounded", maximumActiveInstances: 2 },
        nodes: [
          {
            nodeKey: "implement",
            taskType: "implementation",
            roleId: "developer",
            roleVersion: contract.version,
            roleContractHash: contract.contractHash,
            requiredCapabilityHash: null,
            priority: 60,
            dependencyNodeKeys: [],
            acceptanceCriteria: ["Implement the private routine body."],
            verificationSuiteIds: ["project.quick"],
            approvalRequirements: [],
            expectedPaths: ["src/routine.ts"],
          },
          {
            nodeKey: "verify",
            taskType: "technical.review",
            roleId: "developer",
            roleVersion: contract.version,
            roleContractHash: contract.contractHash,
            requiredCapabilityHash: `sha256:${"c".repeat(64)}`,
            priority: 50,
            dependencyNodeKeys: ["implement"],
            acceptanceCriteria: ["Verify the private routine body."],
            verificationSuiteIds: ["project.full"],
            approvalRequirements: ["review.required"],
            expectedPaths: ["src/routine.ts"],
          },
        ],
      },
      trigger: {
        schemaVersion: 1,
        kind: "manual",
        requestDigest: `sha256:${"a".repeat(64)}`,
        idempotencyKey: `sha256:${"b".repeat(64)}`,
        observedAt: new Date().toISOString(),
      },
    };
    const requestPath = resolve(root, "routine-request.json");
    await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
    const args = ["routine", "materialize", "--from", requestPath];
    const firstOutput = outputIo(root);
    expect(await runCli([...args, "--json"], firstOutput.io), firstOutput.stderr.join("")).toBe(0);
    const first = JSON.parse(firstOutput.stdout.join("")) as {
      plan: { planId: string; status: string; steps: { assignmentId: string }[] };
    };
    expect(first.plan).toMatchObject({ status: "ready" });
    expect(first.plan.steps).toHaveLength(2);
    expect(firstOutput.stdout.join("")).not.toContain("private routine body");

    expect(
      await runCli(
        [
          "assignment",
          "create",
          "--type",
          "maintenance",
          "--role",
          "developer",
          "--criteria",
          "Create a stale-plan observation.",
          "--suite",
          "project.quick",
          "--path",
          "src/unrelated.ts",
          "--workstream",
          workstreamId,
          "--write",
        ],
        quiet,
      ),
    ).toBe(0);
    const stale = outputIo(root);
    expect(
      await runCli([...args, "--apply", first.plan.planId, "--write", "--json"], stale.io),
    ).toBe(1);
    expect(stale.stderr.join("")).toContain("stale");

    const freshOutput = outputIo(root);
    expect(await runCli([...args, "--json"], freshOutput.io)).toBe(0);
    const fresh = JSON.parse(freshOutput.stdout.join("")) as {
      plan: { planId: string; invocationId: string };
    };
    const appliedOutput = outputIo(root);
    expect(
      await runCli([...args, "--apply", fresh.plan.planId, "--write", "--json"], appliedOutput.io),
    ).toBe(0);
    const applied = JSON.parse(appliedOutput.stdout.join("")) as {
      receipt: { status: string; createdAssignmentIds: string[] };
    };
    expect(applied.receipt).toMatchObject({ status: "completed" });
    expect(applied.receipt.createdAssignmentIds).toHaveLength(2);
    const assignments = await listAssignments(root);
    const routineAssignments = assignments.filter(
      (assignment) => assignment.routine?.invocationId === fresh.plan.invocationId,
    );
    expect(routineAssignments).toHaveLength(2);
    expect(routineAssignments.find((item) => item.routine?.nodeKey === "verify")).toMatchObject({
      requiredCapabilityHash: `sha256:${"c".repeat(64)}`,
      dependencyIds: [
        routineAssignments.find((item) => item.routine?.nodeKey === "implement")!.assignmentId,
      ],
    });

    const replay = outputIo(root);
    expect(await runCli([...args, "--json"], replay.io)).toBe(0);
    expect(JSON.parse(replay.stdout.join(""))).toMatchObject({
      plan: { status: "current", disposition: "already_materialized", steps: [] },
      receipt: null,
    });
  });

  it("rejects a forged authenticated-live request from the public routine command", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-assignment-routine-authority-"));
    roots.push(root);
    const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
    expect(await runCli(["init"], quiet)).toBe(0);
    const workstreamId = await activeWorkstream(root);
    const contract = await resolveRoleContract(root, "developer");
    const request = {
      schemaVersion: 1,
      workstreamId,
      template: {
        schemaVersion: 1,
        routineId: "forged.live",
        templateVersion: "1.0.0",
        concurrency: { mode: "enqueue_bounded", maximumActiveInstances: 1 },
        nodes: [
          {
            nodeKey: "attempt",
            taskType: "implementation",
            roleId: "developer",
            roleVersion: contract.version,
            roleContractHash: contract.contractHash,
            requiredCapabilityHash: null,
            priority: 50,
            dependencyNodeKeys: [],
            acceptanceCriteria: ["Must not materialize."],
            verificationSuiteIds: ["project.quick"],
            approvalRequirements: [],
            expectedPaths: ["src/forged.ts"],
          },
        ],
      },
      trigger: {
        schemaVersion: 1,
        kind: "authenticated_live",
        requestDigest: `sha256:${"a".repeat(64)}`,
        idempotencyKey: `sha256:${"b".repeat(64)}`,
        observedAt: new Date().toISOString(),
        adapterId: "forged.adapter",
        adapterVersion: "1.0.0",
        descriptorHash: `sha256:${"c".repeat(64)}`,
        sourceId: "forged.source",
        authorizationHash: `sha256:${"d".repeat(64)}`,
        authenticationReceiptHash: `sha256:${"e".repeat(64)}`,
      },
    };
    const requestPath = resolve(root, "forged-live.json");
    await writeFile(requestPath, `${JSON.stringify(request)}\n`);
    const output = outputIo(root);
    expect(await runCli(["routine", "materialize", "--from", requestPath], output.io)).toBe(1);
    expect(output.stderr.join("")).toContain("in-process live-trigger authority");
    expect(await listAssignments(root)).toHaveLength(0);
  });
});
