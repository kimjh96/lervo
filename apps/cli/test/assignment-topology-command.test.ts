import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createTopologyAssignment, listAssignments } from "@lervo/agent-workforce";
import type {
  AssignmentTopologyChangeRequestV2,
  AssignmentTopologyPlanV2,
  WorkGraphV2,
} from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { resolveRoleContract } from "@lervo/roles";
import { assignmentTopologyDigest } from "@lervo/work-controller";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { recordWorkforceEvent } from "../src/workforce-events.js";

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
  const input = JSON.stringify({
    schemaVersion: 1,
    status: "active",
    title: "Dynamic topology",
    objective: "Extend an assignment graph through exact review.",
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
      stdin: async () => input,
    }),
  ).toBe(0);
  const plan = JSON.parse(planned.stdout.join("")) as {
    planId: string;
    snapshot: { workstreamId: string };
  };
  expect(
    await runCli(["workstream", "start", "--stdin", "--apply", plan.planId], {
      ...planned.io,
      stdin: async () => input,
    }),
  ).toBe(0);
  return plan.snapshot.workstreamId;
}

describe("assignment topology command", () => {
  it("reviews, activates, replays, and exposes a bounded branch and join", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-assignment-topology-"));
    roots.push(root);
    const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
    expect(await runCli(["init"], quiet)).toBe(0);
    const workstreamId = await activeWorkstream(root);
    const contract = await resolveRoleContract(root, "developer");
    expect(
      await runCli(
        [
          "assignment",
          "create",
          "--type",
          "foundation",
          "--role",
          "developer",
          "--criteria",
          "Establish the topology foundation.",
          "--suite",
          "project.quick",
          "--path",
          "src/foundation.ts",
          "--workstream",
          workstreamId,
          "--write",
        ],
        quiet,
      ),
    ).toBe(0);
    const baseAssignment = (await listAssignments(root))[0]!;
    const initialOutput = outputIo(root);
    expect(
      await runCli(["assignment", "topology", "inspect", "--json"], initialOutput.io),
      initialOutput.stderr.join(""),
    ).toBe(0);
    const initial = JSON.parse(initialOutput.stdout.join("")) as WorkGraphV2;
    const shared = {
      roleId: "developer",
      roleVersion: contract.version,
      roleContractHash: contract.contractHash,
      requiredCapabilityHash: null,
      priority: 50,
      approvalRequirements: [],
    };
    const request: AssignmentTopologyChangeRequestV2 = {
      schemaVersion: 2,
      kind: "assignment_topology.change",
      workstreamId,
      expectedGraphHash: initial.graphHash,
      changeKey: "parallel_review_join",
      nodes: [
        {
          nodeKey: "left",
          taskType: "review.left",
          ...shared,
          dependencyAssignmentIds: [baseAssignment.assignmentId],
          dependencyNodeKeys: [],
          acceptanceCriteria: ["Left review passes."],
          verificationSuiteIds: ["project.quick"],
          expectedPaths: ["src/left.ts"],
        },
        {
          nodeKey: "right",
          taskType: "review.right",
          ...shared,
          dependencyAssignmentIds: [baseAssignment.assignmentId],
          dependencyNodeKeys: [],
          acceptanceCriteria: ["Right review passes."],
          verificationSuiteIds: ["project.quick"],
          expectedPaths: ["src/right.ts"],
        },
        {
          nodeKey: "join",
          taskType: "review.join",
          ...shared,
          dependencyAssignmentIds: [],
          dependencyNodeKeys: ["left", "right"],
          acceptanceCriteria: ["Both reviewed results join."],
          verificationSuiteIds: ["project.full"],
          expectedPaths: ["src/join.ts"],
        },
      ],
    };
    const requestPath = resolve(root, "topology-request.json");
    await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
    const args = ["assignment", "topology", "change", "--from", requestPath];
    const plannedOutput = outputIo(root);
    expect(await runCli([...args, "--json"], plannedOutput.io)).toBe(0);
    const planned = JSON.parse(plannedOutput.stdout.join("")) as {
      plan: AssignmentTopologyPlanV2;
    };
    expect(planned.plan.steps).toHaveLength(3);
    expect(plannedOutput.stdout.join("")).not.toContain("Left review passes");

    const rejected = outputIo(root);
    expect(
      await runCli(
        [
          ...args,
          "--apply",
          planned.plan.planId,
          "--approval",
          `sha256:${"0".repeat(64)}`,
          "--reviewer",
          "repository.owner",
          "--write",
        ],
        rejected.io,
      ),
    ).toBe(1);
    expect(rejected.stderr.join("")).toContain("approval hash is stale");

    const interruptedStep = planned.plan.steps[0] as {
      nodeKey: string;
      dependencyIds: string[];
    };
    const interruptedNode = request.nodes.find((node) => node.nodeKey === interruptedStep.nodeKey)!;
    const storage = await openProjectStorage(root);
    try {
      await createTopologyAssignment({
        repositoryRoot: root,
        taskType: interruptedNode.taskType,
        roleId: interruptedNode.roleId,
        roleVersion: interruptedNode.roleVersion,
        roleContractHash: interruptedNode.roleContractHash,
        requiredCapabilityHash: interruptedNode.requiredCapabilityHash,
        priority: interruptedNode.priority,
        dependencyIds: interruptedStep.dependencyIds,
        acceptanceCriteria: interruptedNode.acceptanceCriteria,
        verificationSuiteIds: interruptedNode.verificationSuiteIds,
        approvalRequirements: interruptedNode.approvalRequirements,
        expectedPaths: interruptedNode.expectedPaths,
        workstreamId,
        topology: {
          contractVersion: 2,
          changeId: planned.plan.changeId,
          changeKey: request.changeKey,
          requestHash: planned.plan.requestHash,
          planId: planned.plan.planId,
          approvalHash: planned.plan.approvalHash,
          reviewerIdDigest: assignmentTopologyDigest({
            kind: "assignment_topology_reviewer",
            reviewerId: "repository.owner",
          }),
          expectedNodeCount: request.nodes.length,
          nodeSetHash: assignmentTopologyDigest(request.nodes.map((node) => node.nodeKey).sort()),
          nodeKey: interruptedStep.nodeKey,
        },
        recordEvent: (event) => recordWorkforceEvent(storage, event),
      });
    } finally {
      await storage.close();
    }

    const resumedOutput = outputIo(root);
    expect(await runCli([...args, "--json"], resumedOutput.io)).toBe(0);
    const resumed = JSON.parse(resumedOutput.stdout.join("")) as typeof planned;
    expect(resumed.plan).toMatchObject({ status: "ready", disposition: "resume" });
    expect(resumed.plan.steps).toHaveLength(2);

    const appliedOutput = outputIo(root);
    expect(
      await runCli(
        [
          ...args,
          "--apply",
          resumed.plan.planId,
          "--approval",
          resumed.plan.approvalHash,
          "--reviewer",
          "repository.owner",
          "--write",
          "--json",
        ],
        appliedOutput.io,
      ),
      appliedOutput.stderr.join(""),
    ).toBe(0);
    expect(JSON.parse(appliedOutput.stdout.join(""))).toMatchObject({
      receipt: {
        status: "completed",
        createdAssignmentIds: expect.arrayContaining(
          resumed.plan.steps.map(() => expect.any(String)),
        ),
        existingAssignmentIds: [expect.any(String)],
      },
    });
    const topologyAssignments = (await listAssignments(root)).filter(
      (assignment) => assignment.topology !== null,
    );
    expect(topologyAssignments).toHaveLength(3);
    expect(topologyAssignments.every((assignment) => assignment.status === "queued")).toBe(true);

    const finalOutput = outputIo(root);
    expect(await runCli(["assignment", "topology", "inspect", "--json"], finalOutput.io)).toBe(0);
    const graph = JSON.parse(finalOutput.stdout.join("")) as WorkGraphV2;
    expect(graph).toMatchObject({
      schemaVersion: 2,
      contractVersion: 2,
      validity: { status: "valid" },
      topologyHistory: { status: "valid", changes: [{ assignmentIds: expect.any(Array) }] },
    });
    expect(graph.branchAssignmentIds).toContain(baseAssignment.assignmentId);
    expect(graph.joinAssignmentIds).toContain(
      topologyAssignments.find((assignment) => assignment.topology?.nodeKey === "join")!
        .assignmentId,
    );

    const replay = outputIo(root);
    expect(await runCli([...args, "--json"], replay.io)).toBe(0);
    expect(JSON.parse(replay.stdout.join(""))).toMatchObject({
      plan: { status: "current", disposition: "already_applied", steps: [] },
      receipt: null,
    });
  });
});
