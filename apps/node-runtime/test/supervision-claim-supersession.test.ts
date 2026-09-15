import { rm } from "node:fs/promises";
import type { AutomaticTopologyEffectV1, OperatingActionPlanV1 } from "@lervo/application-contract";
import type { SupervisedResponsibilityClaimV1 } from "@lervo/application-contract";
import { listAssignments } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  automaticTopologyEffectFields,
  createAssignmentTopologyPlan,
  operatingContractHash,
  supervisedResponsibilityClaimFields,
} from "@lervo/work-controller";
import { afterEach, expect, it, vi } from "vitest";
import { responsibility } from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionClaimEffects } from "../src/supervision-claim-effects.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("supersedes a never-bound responsibility claim after its deadline so the owner can decide again", async () => {
  let clockOffset = 0;
  const now = () => new Date(Date.now() + clockOffset).toISOString();
  const f = await supervisionFixture(roots);
  const storage = await openProjectStorage(f.root);
  const reader = new SupervisionTaskSource(storage, f.binding, now);
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
    progressDeadline: new Date(Date.now() + 90_000).toISOString(),
    completionDeadline: new Date(Date.now() + 120_000).toISOString(),
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
  const rationale = await storage.artifacts.put(canonicalJson("Reuse the owner."));
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
  let next = action;
  const execute = vi
    .spyOn(SupervisionClaimEffects.prototype, "execute")
    .mockRejectedValue(new Error("fixture_interrupted_before_binding"));
  const open = () =>
    openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: {
        now,
        propose: async (report) => ({
          ...next,
          sourceRevisionDigest: report.sourceRevisionDigest,
          causationEventIds: report.causationEventIds,
        }),
        execute: async () => {
          throw new Error("Unexpected application effect.");
        },
        inspectEffect: async () => {
          throw new Error("Unexpected application inspection.");
        },
        recordAttention: f.ports.recordAttention,
      },
    });
  let runtime = await open();
  try {
    expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
    const [assignment] = await listAssignments(f.root);
    const claim: SupervisedResponsibilityClaimV1 = {
      schemaVersion: 1,
      kind: "work.responsibility_claim",
      responsibility: task,
      expectedAssignmentHash: operatingContractHash(assignment),
      provider: "codex",
      leaseDurationMs: 60_000,
      rationaleArtifactHash: action.rationaleArtifactHash,
    };
    await storage.artifacts.put(canonicalJson(claim));
    const afterTopology = await reader.read();
    const plan = (effect: SupervisedResponsibilityClaimV1) => ({
      ...action,
      ...supervisedResponsibilityClaimFields(effect),
      graphHash: afterTopology.graph.graphHash,
    });
    next = plan(claim);
    // The claim effect fails before writing anything, so its decision stays pending and uncertain.
    expect((await runtime.runCycle()).disposition).toBe("uncertain");
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await runtime.runCycle()).disposition).toBe("uncertain");
    expect(execute).toHaveBeenCalledTimes(1);
    const inspected = await new SupervisionClaimEffects(f.root, f.binding, now).inspect(
      execute.mock.calls[0]![0],
    );
    expect(inspected.status).toBe("not_started");
    await runtime.close();
    // Past the plan deadline the never-bound claim is superseded and the owner decides again.
    clockOffset = 121_000;
    const renewed: SupervisedResponsibilityClaimV1 = {
      ...claim,
      responsibility: {
        ...task,
        startDeadline: new Date(Date.now() + clockOffset + 60_000).toISOString(),
        progressDeadline: new Date(Date.now() + clockOffset + 90_000).toISOString(),
        completionDeadline: new Date(Date.now() + clockOffset + 120_000).toISOString(),
      },
    };
    await storage.artifacts.put(canonicalJson(renewed));
    next = plan(renewed);
    runtime = await open();
    expect((await runtime.runCycle()).disposition).toBe("changed");
    const events = (await reader.read()).events;
    const supersessions = events.filter(
      (event) => event.type === "work.supervision.decision.superseded",
    );
    expect(supersessions).toHaveLength(1);
    expect(supersessions[0]!.payload.planHash).toBe(
      operatingContractHash(execute.mock.calls[0]![0]),
    );
    expect((await listAssignments(f.root))[0]).toMatchObject({ revision: 1, lease: null });
    expect((await runtime.runCycle()).disposition).toBe("uncertain");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]![0].effectHash).not.toBe(execute.mock.calls[0]![0].effectHash);
  } finally {
    await runtime.close();
    await storage.close();
  }
}, 60_000);
