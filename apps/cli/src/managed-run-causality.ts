import type { ManagedWorkCausalityInput } from "@lervo/orchestrator";
import type { WorkstreamSnapshot } from "@lervo/schemas";

import type { ManagedRunRequest } from "./managed-run.js";

export function resolveManagedRunCausality(input: {
  requested?: ManagedWorkCausalityInput;
  currentWorkstream: WorkstreamSnapshot | null;
  workforce?: NonNullable<ManagedRunRequest["workforce"]>;
}): ManagedWorkCausalityInput {
  const workstreamId = input.currentWorkstream?.workstreamId ?? null;
  const expectedAssignmentId = input.workforce?.assignmentId ?? null;
  const expectedAgentId = input.workforce?.agentId ?? null;
  const requested = input.requested ?? {
    relationship: "root" as const,
    workstreamId,
    assignmentId: expectedAssignmentId,
    agentId: expectedAgentId,
  };
  if (
    (requested.workstreamId ?? null) !== workstreamId ||
    (requested.assignmentId ?? null) !== expectedAssignmentId ||
    (requested.agentId ?? null) !== expectedAgentId
  ) {
    throw new TypeError(
      "Managed work causality differs from the current workstream or workforce authority.",
    );
  }
  if (requested.relationship !== "root" && input.workforce === undefined) {
    throw new TypeError("Managed child or retry causality requires exact workforce authority.");
  }
  return structuredClone(requested);
}
