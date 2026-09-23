import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";

import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readHistoricalOwnerDecision } from "./supervision-control-decision.js";
import { isProvenInterruptedOwnerReasoning } from "./supervision-interrupted-owner-proof.js";

const TYPE = "work.supervision.owner_reasoning.interruption_reconciled";

export function interruptedOwnerReconciliationEventId(runId: string, decisionId: string): string {
  return `evt_${operatingContractHash({ runId, type: TYPE, identity: decisionId }).slice(7, 39)}`;
}

/** Read the exact admitted decision, terminal, pinned run history and private host witness. */
export async function readProvenInterruptedOwnerReasoning(input: {
  storage: { events: EventStore; artifacts: ArtifactStore };
  plan: OperatingActionPlanV1;
  runEvents?: readonly EventEnvelope[];
}): Promise<{ reconciliation: EventEnvelope; terminal: EventEnvelope } | null> {
  if (input.plan.effectContract !== "work.owner_reasoning.v1") return null;
  const admitted = await readHistoricalOwnerDecision(input.storage, input.plan);
  if (admitted.superseded) return null;
  const event = input.storage.events.get(
    interruptedOwnerReconciliationEventId(admitted.runId, admitted.identity),
  );
  if (event === null) return null;
  const planHash = operatingContractHash(input.plan);
  const managedRunId = managedExecutionIdentity(input.plan.projectId, planHash).runId;
  const runEvents =
    input.runEvents ??
    collectRunEventsBounded({
      events: input.storage.events,
      runId: managedRunId,
      maximumEvents: 512,
    });
  const terminal = runEvents.at(-1);
  if (
    terminal === undefined ||
    event.type !== TYPE ||
    event.runId !== admitted.runId ||
    event.payload.supervisionId !== input.plan.supervisionId ||
    event.payload.workstreamId !== input.plan.workstreamId ||
    event.payload.workstreamRevision !== admitted.decision.payload.workstreamRevision ||
    event.payload.ownerAgentId !== input.plan.ownerAgentId ||
    event.payload.mandateHash !== input.plan.mandateHash ||
    event.payload.decisionId !== operatingDecisionId(input.plan) ||
    event.payload.planHash !== planHash ||
    event.payload.managedRunId !== managedRunId ||
    event.payload.terminalEventId !== terminal.eventId ||
    operatingContractHash(event.payload.causationEventIds) !==
      operatingContractHash([admitted.decision.eventId, terminal.eventId])
  )
    return null;
  const hash = String(event.payload.diagnosticArtifactHash);
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(hash) ||
    !(await input.storage.artifacts.has(`lervo-cas://sha256/${hash.slice(7)}`))
  )
    return null;
  const diagnostic = await readSupervisionJsonArtifact(input.storage.artifacts, hash);
  return isProvenInterruptedOwnerReasoning(runEvents, event, diagnostic)
    ? { reconciliation: event, terminal }
    : null;
}
