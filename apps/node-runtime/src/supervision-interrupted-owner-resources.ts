import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { projectWorkstreamResources } from "@lervo/work-controller";

import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readProvenInterruptedOwnerReasoning } from "./supervision-interrupted-owner-source.js";

/** Retain canonical run events while excluding only proven impossible usage from its projection. */
export async function readInterruptedOwnerResourceSource(input: {
  storage: ProjectStorage;
  events: readonly EventEnvelope[];
  workstreamId: string;
  scopeAnchor?: { eventId: string; eventHash: string };
}) {
  const reconciledRunIds = new Set<string>();
  for (const reconciliation of input.events.filter(
    (event) =>
      event.type === "work.supervision.owner_reasoning.interruption_reconciled" &&
      event.payload.workstreamId === input.workstreamId,
  )) {
    const decisions = input.events.filter(
      (event) =>
        event.type === "work.supervision.decision.recorded" &&
        event.payload.decisionId === reconciliation.payload.decisionId &&
        event.payload.planHash === reconciliation.payload.planHash,
    );
    if (decisions.length !== 1)
      throw new Error("The interrupted owner reconciliation lacks one admitted decision.");
    const plan = (await readSupervisionJsonArtifact(
      input.storage.artifacts,
      String(decisions[0]!.payload.planArtifactHash),
    )) as OperatingActionPlanV1;
    if (
      (await readProvenInterruptedOwnerReasoning({ storage: input.storage, plan }))?.reconciliation
        .eventId !== reconciliation.eventId ||
      reconciledRunIds.has(String(reconciliation.payload.managedRunId))
    )
      throw new Error("The interrupted owner reconciliation proof is invalid or duplicated.");
    reconciledRunIds.add(String(reconciliation.payload.managedRunId));
  }
  const resourceEvents = input.events.filter(
    (event) =>
      !(
        reconciledRunIds.has(event.runId) &&
        ["adapter.started", "resource.usage.recorded"].includes(event.type)
      ),
  );
  return {
    reconciledRunIds: [...reconciledRunIds].sort(),
    workstreamResources: projectWorkstreamResources({
      events: resourceEvents,
      workstreamId: input.workstreamId,
      scopeAnchor: input.scopeAnchor,
    }),
  };
}
