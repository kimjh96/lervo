import { describe, expect, it } from "vitest";

import type {
  AssignmentTopologyAssignmentObservationV2,
  AssignmentTopologyChangeRequestV2,
} from "@lervo/application-contract";

import { createAssignmentTopologyPlan } from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const projectId = "prj_0123456789abcdef";
const workstreamId = "wks_0123456789abcdef01234567";
const role = {
  roleId: "developer",
  roleVersion: "1.0.0",
  roleContractHash: hash("a"),
};

function request(): AssignmentTopologyChangeRequestV2 {
  return {
    schemaVersion: 2,
    kind: "assignment_topology.change",
    workstreamId,
    expectedGraphHash: hash("b"),
    changeKey: "review_and_join",
    nodes: [
      {
        nodeKey: "review_a",
        taskType: "review.a",
        ...role,
        requiredCapabilityHash: null,
        priority: 60,
        dependencyAssignmentIds: ["asn_111111111111111111111111"],
        dependencyNodeKeys: [],
        acceptanceCriteria: ["Review A passes."],
        verificationSuiteIds: ["verify.a"],
        approvalRequirements: [],
        expectedPaths: ["src/a.ts"],
      },
      {
        nodeKey: "review_b",
        taskType: "review.b",
        ...role,
        requiredCapabilityHash: null,
        priority: 60,
        dependencyAssignmentIds: ["asn_111111111111111111111111"],
        dependencyNodeKeys: [],
        acceptanceCriteria: ["Review B passes."],
        verificationSuiteIds: ["verify.b"],
        approvalRequirements: [],
        expectedPaths: ["src/b.ts"],
      },
      {
        nodeKey: "join",
        taskType: "join.results",
        ...role,
        requiredCapabilityHash: null,
        priority: 50,
        dependencyAssignmentIds: [],
        dependencyNodeKeys: ["review_a", "review_b"],
        acceptanceCriteria: ["Both reviews are integrated."],
        verificationSuiteIds: ["verify.join"],
        approvalRequirements: [],
        expectedPaths: ["src/join.ts"],
      },
    ],
  };
}

function existing(): AssignmentTopologyAssignmentObservationV2 {
  return {
    assignmentId: "asn_111111111111111111111111",
    revision: 2,
    status: "completed",
    workstreamId,
    taskType: "foundation",
    ...role,
    requiredCapabilityHash: null,
    priority: 50,
    dependencyIds: [],
    acceptanceDigest: hash("c"),
    verificationDigest: hash("d"),
    approvalDigest: hash("e"),
    expectedPathDigest: hash("f"),
    topology: null,
  };
}

describe("assignment topology planning", () => {
  it("plans a deterministic bounded fan-out branch and fan-in join", () => {
    const plan = createAssignmentTopologyPlan({
      projectId,
      currentWorkstreamId: workstreamId,
      currentGraphHash: hash("b"),
      graphValid: true,
      request: request(),
      roleContracts: [role],
      assignments: [existing()],
    });

    expect(plan).toMatchObject({
      schemaVersion: 2,
      status: "ready",
      disposition: "materialize",
      blockedReasons: [],
    });
    expect(plan.steps).toHaveLength(3);
    expect(plan.branchAssignmentIds).toEqual([existing().assignmentId]);
    expect(plan.joinAssignmentIds).toEqual([
      plan.steps.find((step) => step.nodeKey === "join")!.assignmentId,
    ]);
    expect(plan.steps.find((step) => step.nodeKey === "join")!.dependencyIds).toEqual(
      plan.steps
        .filter((step) => step.nodeKey.startsWith("review_"))
        .map((step) => step.assignmentId)
        .sort(),
    );
  });

  it("fails closed on stale graph authority and cyclic proposed nodes", () => {
    const stale = createAssignmentTopologyPlan({
      projectId,
      currentWorkstreamId: workstreamId,
      currentGraphHash: hash("9"),
      graphValid: true,
      request: request(),
      roleContracts: [role],
      assignments: [existing()],
    });
    expect(stale).toMatchObject({ status: "blocked", blockedReasons: ["graph_changed"] });

    const cyclic = request();
    cyclic.nodes[0]!.dependencyNodeKeys = ["join"];
    expect(() =>
      createAssignmentTopologyPlan({
        projectId,
        currentWorkstreamId: workstreamId,
        currentGraphHash: hash("b"),
        graphValid: true,
        request: cyclic,
        roleContracts: [role],
        assignments: [existing()],
      }),
    ).toThrow("dependency cycle");
  });

  it("does not let an unrelated same-change node waive stale graph authority", () => {
    const initial = createAssignmentTopologyPlan({
      projectId,
      currentWorkstreamId: workstreamId,
      currentGraphHash: hash("b"),
      graphValid: true,
      request: request(),
      roleContracts: [role],
      assignments: [existing()],
    });
    const foreign: AssignmentTopologyAssignmentObservationV2 = {
      ...existing(),
      assignmentId: "asn_222222222222222222222222",
      topology: {
        contractVersion: 2,
        changeId: initial.changeId,
        changeKey: initial.changeKey,
        requestHash: initial.requestHash,
        planId: initial.planId,
        approvalHash: initial.approvalHash,
        reviewerIdDigest: hash("7"),
        expectedNodeCount: 3,
        nodeSetHash: hash("8"),
        nodeKey: "foreign",
      },
    };
    const recovered = createAssignmentTopologyPlan({
      projectId,
      currentWorkstreamId: workstreamId,
      currentGraphHash: hash("9"),
      graphValid: true,
      request: request(),
      roleContracts: [role],
      assignments: [existing(), foreign],
    });
    expect(recovered).toMatchObject({
      status: "blocked",
      blockedReasons: ["existing_assignment_mismatch"],
    });
  });

  it("keeps host assignment capacity distinct from the graph safety bound", () => {
    const capacityLimited = createAssignmentTopologyPlan({
      projectId,
      currentWorkstreamId: workstreamId,
      currentGraphHash: hash("b"),
      graphValid: true,
      request: request(),
      roleContracts: [role],
      assignments: [existing()],
      maximumAssignments: 3,
    });

    expect(capacityLimited).toMatchObject({
      status: "blocked",
      blockedReasons: ["assignment_capacity"],
    });
  });
});
