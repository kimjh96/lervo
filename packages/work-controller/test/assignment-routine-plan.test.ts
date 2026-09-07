import type {
  AssignmentRoutineAssignmentObservationV1,
  AssignmentRoutineRequestV1,
} from "@lervo/application-contract";
import { describe, expect, it } from "vitest";

import { assignmentRoutineDigest, createAssignmentRoutinePlan } from "../src/index.js";

const hash = (value: string) => `sha256:${value.repeat(64)}`;
const projectId = "prj_abcdefabcdefabcd";
const workstreamId = "wks_abcdefabcdefabcdefabcdef";
const roleContractHash = hash("a");

function request(
  mode: "skip_if_active" | "coalesce_if_active" | "enqueue_bounded" = "enqueue_bounded",
): AssignmentRoutineRequestV1 {
  return {
    schemaVersion: 1,
    workstreamId,
    template: {
      schemaVersion: 1,
      routineId: "review.change",
      templateVersion: "1.0.0",
      concurrency: { mode, maximumActiveInstances: mode === "enqueue_bounded" ? 2 : 1 },
      nodes: [
        {
          nodeKey: "implement",
          taskType: "implementation",
          roleId: "developer",
          roleVersion: "1.0.0",
          roleContractHash,
          requiredCapabilityHash: null,
          priority: 60,
          dependencyNodeKeys: [],
          acceptanceCriteria: ["Implement the bounded change."],
          verificationSuiteIds: ["project.quick"],
          approvalRequirements: [],
          expectedPaths: ["src"],
        },
        {
          nodeKey: "verify",
          taskType: "technical.review",
          roleId: "developer",
          roleVersion: "1.0.0",
          roleContractHash,
          requiredCapabilityHash: hash("b"),
          priority: 50,
          dependencyNodeKeys: ["implement"],
          acceptanceCriteria: ["Verify the bounded change."],
          verificationSuiteIds: ["project.full"],
          approvalRequirements: ["review.required"],
          expectedPaths: ["src"],
        },
      ],
    },
    trigger: {
      schemaVersion: 1,
      kind: "manual",
      requestDigest: hash("c"),
      idempotencyKey: hash("d"),
      observedAt: "2026-09-02T04:00:00.000Z",
    },
  };
}

const roleContracts = [{ roleId: "developer", roleVersion: "1.0.0", roleContractHash }];

function observation(
  plan: ReturnType<typeof createAssignmentRoutinePlan>,
  nodeKey: "implement" | "verify",
  status: AssignmentRoutineAssignmentObservationV1["status"] = "queued",
): AssignmentRoutineAssignmentObservationV1 {
  const source = request().template.nodes.find((node) => node.nodeKey === nodeKey)!;
  const step = plan.steps.find((item) => item.nodeKey === nodeKey)!;
  return {
    assignmentId: step.assignmentId,
    revision: 1,
    status,
    taskType: source.taskType,
    roleId: source.roleId,
    roleVersion: source.roleVersion,
    roleContractHash: source.roleContractHash,
    requiredCapabilityHash: source.requiredCapabilityHash,
    priority: source.priority,
    dependencyIds: step.dependencyIds,
    acceptanceDigest: assignmentRoutineDigest(source.acceptanceCriteria),
    verificationDigest: assignmentRoutineDigest([...source.verificationSuiteIds].sort()),
    approvalDigest: assignmentRoutineDigest([...source.approvalRequirements].sort()),
    expectedPathDigest: assignmentRoutineDigest([...source.expectedPaths].sort()),
    routine: {
      routineId: plan.routineId,
      templateVersion: plan.templateVersion,
      templateHash: plan.templateHash,
      invocationId: plan.invocationId,
      triggerKind: "manual",
      triggerDigest: plan.triggerDigest,
      nodeKey,
    },
  };
}

function plan(input: {
  request?: AssignmentRoutineRequestV1;
  assignments?: AssignmentRoutineAssignmentObservationV1[];
  contracts?: typeof roleContracts;
}) {
  return createAssignmentRoutinePlan({
    projectId,
    currentWorkstreamId: workstreamId,
    request: input.request ?? request(),
    roleContracts: input.contracts ?? roleContracts,
    assignments: input.assignments ?? [],
  });
}

describe("assignment routine planning", () => {
  it("builds deterministic topological assignment identities without storing prompt execution", () => {
    const first = plan({});
    const second = plan({});
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "ready",
      disposition: "materialize",
      steps: [
        { nodeKey: "implement", dependencyIds: [], requiredCapabilityHash: null },
        { nodeKey: "verify", requiredCapabilityHash: hash("b") },
      ],
    });
    expect(first.steps[1]!.dependencyIds).toEqual([first.steps[0]!.assignmentId]);
    expect(JSON.stringify(first)).not.toContain("Implement the bounded change");
  });

  it("resumes a partial deterministic invocation and rejects changed materialization", () => {
    const initial = plan({});
    const partial = observation(initial, "implement");
    const resumed = plan({ assignments: [partial] });
    expect(resumed).toMatchObject({ status: "ready", disposition: "resume" });
    expect(resumed.steps.map((item) => item.nodeKey)).toEqual(["verify"]);
    expect(plan({ assignments: [{ ...partial, priority: partial.priority + 1 }] })).toMatchObject({
      status: "blocked",
      blockedReasons: ["existing_assignment_mismatch"],
    });
    expect(
      plan({
        assignments: [partial, observation(initial, "verify", "completed")],
      }),
    ).toMatchObject({ status: "current", disposition: "already_materialized" });
  });

  it("keeps skip, coalesce, and bounded enqueue policies distinct", () => {
    const initial = plan({});
    const active = observation(initial, "implement");
    const nextRequest = request("skip_if_active");
    nextRequest.trigger.idempotencyKey = hash("e");
    expect(plan({ request: nextRequest, assignments: [active] })).toMatchObject({
      status: "current",
      disposition: "skipped",
      relatedInvocationId: null,
    });
    nextRequest.template.concurrency.mode = "coalesce_if_active";
    expect(plan({ request: nextRequest, assignments: [active] })).toMatchObject({
      status: "current",
      disposition: "coalesced",
      relatedInvocationId: initial.invocationId,
    });
    nextRequest.template.concurrency = { mode: "enqueue_bounded", maximumActiveInstances: 1 };
    expect(plan({ request: nextRequest, assignments: [active] })).toMatchObject({
      status: "blocked",
      blockedReasons: ["routine_concurrency_limit"],
    });
  });

  it("fails closed on stale roles, foreign workstreams, and cyclic templates", () => {
    expect(
      plan({
        contracts: [{ roleId: "developer", roleVersion: "1.0.1", roleContractHash: hash("f") }],
      }),
    ).toMatchObject({ status: "blocked", blockedReasons: ["role_contract_stale"] });
    const foreign = request();
    foreign.workstreamId = "wks_111111111111111111111111";
    expect(plan({ request: foreign })).toMatchObject({
      status: "blocked",
      blockedReasons: ["workstream_mismatch"],
    });
    const cyclic = request();
    cyclic.template.nodes[0]!.dependencyNodeKeys = ["verify"];
    expect(() => plan({ request: cyclic })).toThrow(/cycle/u);
    expect(
      createAssignmentRoutinePlan({
        projectId,
        currentWorkstreamId: workstreamId,
        request: request(),
        roleContracts,
        assignments: [],
        maximumAssignments: 1,
      }),
    ).toMatchObject({ status: "blocked", blockedReasons: ["assignment_capacity"] });
    const automatic = request();
    (automatic.trigger as { kind: string }).kind = "cron";
    expect(() => plan({ request: automatic })).toThrow(/trigger is invalid/u);
  });
});
