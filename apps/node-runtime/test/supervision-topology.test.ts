import { rm } from "node:fs/promises";
import type { AutomaticTopologyEffectV1, OperatingActionPlanV1 } from "@lervo/application-contract";
import type { SupervisedResponsibilityClaimV1 } from "@lervo/application-contract";
import { listAssignments, createAssignment, claimAssignment } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  automaticTopologyEffectFields,
  createAssignmentTopologyPlan,
  operatingContractHash,
  supervisedResponsibilityClaimFields,
} from "@lervo/work-controller";
import { SupervisionClaimEffects } from "../src/supervision-claim-effects.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { responsibility } from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { readCanonicalSupervisionTopology } from "../src/supervision-topology-source.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const f = await supervisionFixture(roots);
  const storage = await openProjectStorage(f.root);
  const reader = new SupervisionTaskSource(storage, f.binding, f.ports.now);
  const source = await reader.read();
  const task = {
    ...responsibility(),
    executorAgentId: f.owner.agentId,
    reviewerAgentId: f.owner.agentId,
    roleVersion: f.owner.roleVersion,
    roleContractHash: f.owner.roleContractHash,
    assignmentRevision: 2,
    requiredCapabilities: ["filesystem.read"],
    startDeadline: new Date(Date.now() + 60_000).toISOString(),
    progressDeadline: new Date(Date.now() + 120_000).toISOString(),
    completionDeadline: new Date(Date.now() + 300_000).toISOString(),
    handoffRecipientIds: [f.owner.agentId],
  };
  const request = {
    schemaVersion: 2 as const,
    kind: "assignment_topology.change" as const,
    workstreamId: f.binding.workstreamId,
    expectedGraphHash: source.graph.graphHash,
    changeKey: "save-fix",
    nodes: [
      {
        nodeKey: "fix",
        taskType: "implementation",
        roleId: task.roleId,
        roleVersion: task.roleVersion,
        roleContractHash: task.roleContractHash,
        requiredCapabilityHash: null,
        priority: 50,
        dependencyAssignmentIds: [],
        dependencyNodeKeys: [],
        acceptanceCriteria: task.acceptanceCriteria,
        verificationSuiteIds: task.verificationSuiteIds,
        approvalRequirements: [],
        expectedPaths: task.expectedPaths,
      },
    ],
  };
  const topology = createAssignmentTopologyPlan({
    projectId: f.owner.projectId,
    currentWorkstreamId: f.binding.workstreamId,
    currentGraphHash: source.graph.graphHash,
    graphValid: true,
    request,
    roleContracts: [
      {
        roleId: task.roleId,
        roleVersion: task.roleVersion,
        roleContractHash: task.roleContractHash,
      },
    ],
    assignments: [],
    maximumAssignments: 256,
  });
  task.assignmentId = topology.steps[0]!.assignmentId;
  const effect: AutomaticTopologyEffectV1 = {
    schemaVersion: 1,
    kind: "assignment_topology.automatic_effect",
    request,
    topology,
    responsibility: task,
    provider: "codex",
    reservedTokens: 100,
  };
  await storage.artifacts.put(canonicalJson(effect));
  const rationale = await storage.artifacts.put(
    canonicalJson("Reuse the qualified available owner within the existing path scope."),
  );
  const action: OperatingActionPlanV1 = {
    schemaVersion: 1,
    ...f.binding,
    projectId: f.owner.projectId,
    teamId: f.mandate.teamIds[0]!,
    sourceRevisionDigest: source.sourceRevisionDigest,
    graphHash: source.graph.graphHash,
    causationEventIds: [source.sourceEventId],
    rationaleArtifactHash: rationale.contentHash,
    ...automaticTopologyEffectFields(effect),
  };
  return { ...f, storage, reader, source, effect, action };
}

describe("canonical Node automatic topology", { timeout: 30_000 }, () => {
  it("creates and claims one policy-bound assignment through canonical admission, then recovers the exact claim without another acquisition", async () => {
    const f = await fixture();
    const fallback = vi.fn(async () => {
      throw new Error("Unexpected application effect.");
    });
    let next = f.action;
    let proposed = f.action;
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: {
        now: f.ports.now,
        propose: async (report) =>
          (proposed = {
            ...next,
            sourceRevisionDigest: report.sourceRevisionDigest,
            causationEventIds: report.causationEventIds,
          }),
        execute: fallback,
        inspectEffect: fallback,
        recordAttention: f.ports.recordAttention,
      },
    });
    try {
      const first = await runtime.runCycle();
      expect(first.disposition).toBe("effect_confirmed");
      const assignments = await listAssignments(f.root);
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({
        assignmentId: f.effect.responsibility.assignmentId,
        revision: 1,
        status: "blocked",
        lease: null,
      });
      expect(assignments[0]!.topology?.policyReview?.schemaVersion).toBe(1);
      const claim: SupervisedResponsibilityClaimV1 = {
        schemaVersion: 1,
        kind: "work.responsibility_claim",
        responsibility: f.effect.responsibility,
        expectedAssignmentHash: operatingContractHash(assignments[0]),
        provider: "codex",
        leaseDurationMs: 60_000,
        rationaleArtifactHash: f.action.rationaleArtifactHash,
      };
      await f.storage.artifacts.put(canonicalJson(claim));
      const afterTopology = await f.reader.read();
      next = {
        ...f.action,
        ...supervisedResponsibilityClaimFields(claim),
        graphHash: afterTopology.graph.graphHash,
      };
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      const claimed = (await listAssignments(f.root))[0]!;
      expect(claimed).toMatchObject({
        revision: 2,
        status: "leased",
        assigneeAgentId: f.owner.agentId,
      });
      const recovered = await new SupervisionClaimEffects(f.root, f.binding, f.ports.now).inspect(
        proposed,
      );
      expect(recovered.status).toBe("confirmed");
      expect((await f.reader.read()).responsibilities[0]!.binding?.responsibility).toEqual(
        claim.responsibility,
      );
      expect(await runtime.runCycle()).toMatchObject({
        disposition: "blocked",
        report: { nextAction: "dispatch" },
      });
      expect(await listAssignments(f.root)).toHaveLength(1);
      expect((await listAssignments(f.root))[0]!.lease?.leaseId).toBe(claimed.lease?.leaseId);
      expect(fallback).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
      await f.storage.close();
    }
  });

  it("rejects a changed role contract even when the proposed structural plan is internally consistent", async () => {
    const f = await fixture();
    try {
      const changed = structuredClone(f.effect);
      changed.request.nodes[0]!.roleContractHash = `sha256:${"b".repeat(64)}`;
      changed.responsibility.roleContractHash = changed.request.nodes[0]!.roleContractHash;
      changed.topology = createAssignmentTopologyPlan({
        projectId: f.owner.projectId,
        currentWorkstreamId: f.binding.workstreamId,
        currentGraphHash: f.source.graph.graphHash,
        graphValid: true,
        request: changed.request,
        roleContracts: [
          {
            roleId: changed.responsibility.roleId,
            roleVersion: changed.responsibility.roleVersion,
            roleContractHash: changed.responsibility.roleContractHash,
          },
        ],
        assignments: [],
        maximumAssignments: 256,
      });
      changed.responsibility.assignmentId = changed.topology.steps[0]!.assignmentId;
      await f.storage.artifacts.put(canonicalJson(changed));
      const plan = { ...f.action, ...automaticTopologyEffectFields(changed) };
      await expect(
        readCanonicalSupervisionTopology({
          repositoryRoot: f.root,
          source: f.source,
          artifacts: f.storage.artifacts,
          plan,
          now: f.ports.now,
        }),
      ).rejects.toThrow(/canonical structural/iu);
      expect(await listAssignments(f.root)).toEqual([]);
    } finally {
      await f.storage.close();
    }
  });

  it("rejects a live conflicting lease before creating another responsibility", async () => {
    const f = await fixture();
    try {
      const assignment = await createAssignment({
        repositoryRoot: f.root,
        workstreamId: f.binding.workstreamId,
        roleId: f.owner.roleId,
        taskType: "implementation",
        expectedPaths: ["src"],
        acceptanceCriteria: ["Existing task"],
        verificationSuiteIds: ["save.restart"],
      });
      await claimAssignment({
        repositoryRoot: f.root,
        assignmentId: assignment.assignmentId,
        agentId: f.owner.agentId,
        sessionId: "ses_existing_lease",
      });
      await expect(
        readCanonicalSupervisionTopology({
          repositoryRoot: f.root,
          source: f.source,
          artifacts: f.storage.artifacts,
          plan: f.action,
          now: f.ports.now,
        }),
      ).rejects.toThrow(/assignment source changed/iu);
      expect((await listAssignments(f.root)).map((item) => item.assignmentId)).toEqual([
        assignment.assignmentId,
      ]);
      expect(operatingContractHash(f.effect)).toBe(f.action.effectHash);
    } finally {
      await f.storage.close();
    }
  });
});
