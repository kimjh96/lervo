import { observedSupervisionRunTermination } from "./supervision-run-termination.js";
import type { SupervisedOwnerReasoningV1 } from "@lervo/application-contract";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { supervisedOwnerReasoningFields } from "@lervo/work-controller";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { EventStore, ArtifactStore } from "@lervo/storage-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionTextArtifact } from "./supervision-artifact-json.js";

/** A reconciled model invocation is not an accepted business result or a new effect authorization. */
export async function inspectOwnerReasoning(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
) {
  const admitted = await readAdmittedControlDecision(storage, plan);
  const effect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    plan.effectHash,
  )) as SupervisedOwnerReasoningV1;
  const fields = supervisedOwnerReasoningFields(effect);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The reasoning receipt differs from its exact provider effect.");
  const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  const events = collectRunEventsBounded({
    events: storage.events,
    runId: identity.runId,
    maximumEvents: 4096,
  });
  if (events.length === 0) return { status: "not_started" as const };
  const reservation = events.find((event) => event.type === "managed.execution.reserved");
  const requested = events.find((event) => event.type === "run.requested");
  const causal = events.find((event) => event.type === "work.causality.recorded");
  const termination = observedSupervisionRunTermination(events);
  if (
    reservation?.schemaVersion !== 3 ||
    reservation.payload.executionKey !== operatingContractHash(plan) ||
    reservation.payload.requestHash !== plan.effectHash ||
    reservation.seq <= admitted.decision.seq ||
    requested === undefined ||
    causal?.payload.workstreamId !== plan.workstreamId ||
    causal.payload.agentId !== plan.ownerAgentId ||
    causal.payload.assignmentId !== null ||
    causal.payload.relationship !== (effect.attemptNumber === 1 ? "root" : "retry") ||
    causal.payload.attemptOrdinal !== effect.attemptNumber ||
    termination === null
  )
    return { status: "uncertain" as const };
  const { terminal, stopped } = termination;
  if (terminal.type === "run.completed")
    await readSupervisionTextArtifact(storage.artifacts, String(terminal.payload.resultDigest));
  return {
    status: "confirmed" as const,
    eventIds: [reservation.eventId, requested.eventId, terminal.eventId, stopped.eventId],
  };
}
