export const workforceLimits = {
  maximumAgents: 256,
  maximumAssignments: 10_000,
  maximumDelegationDepth: 8,
  maximumAssignmentDependencies: 64,
  maximumIntegrationBatch: 32,
  maximumConcurrentLeases: 256,
} as const;

export type WorkforceAdmissionReason =
  | "agent_capacity"
  | "assignment_capacity"
  | "delegation_depth"
  | "fanout_capacity"
  | "concurrency_capacity"
  | "integration_batch_capacity";

export function evaluateWorkforceAdmission(input: {
  currentAgents: number;
  currentAssignments: number;
  activeLeases: number;
  requestedAgents?: number;
  requestedAssignments?: number;
  requestedFanout?: number;
  requestedIntegrationBatch?: number;
  delegationDepth?: number;
}): { status: "admitted" } | { status: "rejected"; reason: WorkforceAdmissionReason } {
  const requestedAgents = input.requestedAgents ?? 0;
  const requestedAssignments = input.requestedAssignments ?? 0;
  const requestedFanout = input.requestedFanout ?? 0;
  const requestedIntegrationBatch = input.requestedIntegrationBatch ?? 0;
  const delegationDepth = input.delegationDepth ?? 0;
  const values = [
    input.currentAgents,
    input.currentAssignments,
    input.activeLeases,
    requestedAgents,
    requestedAssignments,
    requestedFanout,
    requestedIntegrationBatch,
    delegationDepth,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError("Workforce admission coordinates are invalid.");
  }
  if (input.currentAgents + requestedAgents > workforceLimits.maximumAgents)
    return { status: "rejected", reason: "agent_capacity" };
  if (input.currentAssignments + requestedAssignments > workforceLimits.maximumAssignments)
    return { status: "rejected", reason: "assignment_capacity" };
  if (delegationDepth > workforceLimits.maximumDelegationDepth)
    return { status: "rejected", reason: "delegation_depth" };
  if (requestedFanout > workforceLimits.maximumAssignmentDependencies)
    return { status: "rejected", reason: "fanout_capacity" };
  if (input.activeLeases + requestedAgents > workforceLimits.maximumConcurrentLeases)
    return { status: "rejected", reason: "concurrency_capacity" };
  if (requestedIntegrationBatch > workforceLimits.maximumIntegrationBatch)
    return { status: "rejected", reason: "integration_batch_capacity" };
  return { status: "admitted" };
}
