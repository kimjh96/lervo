import { nativeTaskRequirement } from "./supervision-native-task.js";
import type { AutomaticTopologyEffectV1 } from "@lervo/application-contract";
import { listAssignments, topologyAssignmentObservation } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/event-contract";
import { createAssignmentTopologyPlan } from "@lervo/work-controller";
import { prepareSupervisionWorkforcePlan } from "./supervision-workforce-planning.js";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";

export async function nativeAllocation(
  input: NativeOwnerPlanInput,
  details: Record<string, unknown>,
  rationaleArtifactHash: string,
) {
  const { facts, base, storage } = input;
  const { task, role } = nativeTaskRequirement(input, details);
  const planning = await prepareSupervisionWorkforcePlan({
    repositoryRoot: storage.paths.repositoryRoot,
    projectId: base.projectId,
    workstreamId: base.workstreamId,
    workstreamRevision: facts.workstream.revision,
    ownerAgentId: base.ownerAgentId,
    provider: base.provider as "codex" | "claude",
    responsibility: task,
    configuration: input.readiness,
    now: input.now,
  });
  if (planning.selection.agentId === null)
    throw new Error("No available qualified worker can receive the proposed responsibility.");
  task.executorAgentId = planning.selection.agentId;
  const request = {
    schemaVersion: 2 as const,
    kind: "assignment_topology.change" as const,
    workstreamId: base.workstreamId,
    expectedGraphHash: base.graphHash,
    changeKey: `outcome-${input.resultArtifactHash.slice(7, 31)}`,
    nodes: [
      {
        nodeKey: "task",
        taskType: role.profile.requestTypes[0] ?? "implementation",
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
    projectId: base.projectId,
    currentWorkstreamId: base.workstreamId,
    currentGraphHash: base.graphHash,
    graphValid: true,
    request,
    roleContracts: facts.roles.map((role) => ({
      roleId: role.roleId,
      roleVersion: role.version,
      roleContractHash: role.contractHash,
    })),
    assignments: (await listAssignments(storage.paths.repositoryRoot)).map(
      topologyAssignmentObservation,
    ),
    maximumAssignments: 256,
  });
  if (topology.steps.length !== 1)
    throw new Error("The owner allocation has no exact new structural node.");
  task.assignmentId = topology.steps[0]!.assignmentId;
  const finalPlanning = await prepareSupervisionWorkforcePlan({
    repositoryRoot: storage.paths.repositoryRoot,
    projectId: base.projectId,
    workstreamId: base.workstreamId,
    workstreamRevision: facts.workstream.revision,
    ownerAgentId: base.ownerAgentId,
    provider: base.provider as "codex" | "claude",
    responsibility: task,
    configuration: input.readiness,
    now: input.now,
  });
  if (finalPlanning.selection.agentId !== task.executorAgentId)
    throw new Error("The selected worker changed while preparing the exact responsibility.");
  const evidence = await storage.artifacts.put(
    canonicalJson({
      reasoningResult: input.resultArtifactHash,
      rationaleArtifactHash,
      planning: finalPlanning.evidence,
      retrieval: finalPlanning.context.evidence,
      workforce: finalPlanning.workforce,
    }),
  );
  const groundedRationale = await storage.artifacts.put(
    canonicalJson(
      `${input.decision.rationale}\nReasoning result: ${input.resultArtifactHash}\nGrounded staffing alternatives: ${evidence.contentHash}`,
    ),
  );
  const effect: AutomaticTopologyEffectV1 = {
    schemaVersion: 1,
    kind: "assignment_topology.automatic_effect",
    request,
    topology,
    responsibility: task,
    provider: base.provider,
    reservedTokens: 1,
  };
  return { effect, rationaleArtifactHash: groundedRationale.contentHash };
}
