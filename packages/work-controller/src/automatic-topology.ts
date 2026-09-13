import type { AutomaticTopologyEffectV1, OperatingActionPlanV1 } from "@lervo/application-contract";
import { assertWorkResponsibility, operatingInteger } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";
import {
  assignmentTopologyId,
  validateAndOrderAssignmentTopologyRequest,
} from "./assignment-topology-validation.js";

export const automaticTopologyReviewerDigest = operatingContractHash({
  kind: "assignment_topology_policy",
  reviewerPolicyId: "lervo.operating-mandate.v1",
});

/** Derives scope from the actual materialization payload, independently of an owner's proposal. */
export function automaticTopologyEffectFields(effect: AutomaticTopologyEffectV1) {
  const { request, topology, responsibility: task } = effect;
  const nodes = validateAndOrderAssignmentTopologyRequest(request);
  assertWorkResponsibility(task);
  const { planId, ...content } = topology;
  const node = nodes[0]!;
  const step = topology.steps[0];
  const sameSet = (left: string[], right: string[]) =>
    operatingContractHash([...left].sort()) === operatingContractHash([...right].sort());
  if (
    Object.keys(effect).length !== 7 ||
    Object.keys(request).length !== 6 ||
    Object.keys(node).length !== 13 ||
    Buffer.byteLength(JSON.stringify(effect)) > 256 * 1024 ||
    effect.schemaVersion !== 1 ||
    effect.kind !== "assignment_topology.automatic_effect" ||
    nodes.length !== 1 ||
    topology.steps.length !== 1 ||
    step === undefined ||
    topology.status !== "ready" ||
    topology.disposition !== "materialize" ||
    topology.blockedReasons.length !== 0 ||
    planId !== assignmentTopologyId("gtp", content) ||
    topology.requestHash !== operatingContractHash(request) ||
    topology.workstreamId !== request.workstreamId ||
    topology.currentGraphHash !== request.expectedGraphHash ||
    step.nodeKey !== node.nodeKey ||
    step.assignmentId !== task.assignmentId ||
    task.assignmentRevision !== 2 ||
    task.predecessorBindingHash !== null ||
    task.roleId !== node.roleId ||
    task.roleVersion !== node.roleVersion ||
    task.roleContractHash !== node.roleContractHash ||
    operatingContractHash(task.acceptanceCriteria) !==
      operatingContractHash(node.acceptanceCriteria) ||
    !sameSet(task.expectedPaths, node.expectedPaths) ||
    !sameSet(task.verificationSuiteIds, node.verificationSuiteIds) ||
    node.approvalRequirements.length !== 0 ||
    !operatingInteger(effect.reservedTokens, 1) ||
    !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(effect.provider)
  )
    throw new Error(
      "The automatic topology effect does not match its exact structural plan and duties.",
    );
  return {
    actionKind: "allocate_existing" as const,
    effectContract: "assignment.topology.materialize.v1",
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(task),
    roleId: node.roleId,
    requiredCapabilities: [...task.requiredCapabilities],
    expectedPaths: [...node.expectedPaths].sort(),
    provider: effect.provider,
    addedWorkers: 0,
    addedAssignments: 1,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: effect.reservedTokens,
    deadline: task.completionDeadline,
  } satisfies Pick<
    OperatingActionPlanV1,
    | "actionKind"
    | "effectContract"
    | "effectHash"
    | "responsibilityArtifactHash"
    | "roleId"
    | "requiredCapabilities"
    | "expectedPaths"
    | "provider"
    | "addedWorkers"
    | "addedAssignments"
    | "concurrentAttempts"
    | "attemptNumber"
    | "reservedTokens"
    | "deadline"
  >;
}
