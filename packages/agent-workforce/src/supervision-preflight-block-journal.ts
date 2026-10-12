import type {
  OperatingActionPlanV1,
  SupervisionDecisionReceipt,
  SupervisionPreflightInspectionV1,
} from "@lervo/application-contract";
import { collectEventsOfTypesBounded, type EventStore } from "@lervo/storage-contract";
import { lineageRootId, operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import type {
  SupervisionEventJournal,
  SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";
import { supervisionPayloadFromDecision } from "./supervision-readiness-failure-journal.js";

const BLOCKED = "work.supervision.preflight.blocked";
const RESOLVED = "work.supervision.preflight.resolved";
const HASH = /^sha256:[a-f0-9]{64}$/u;
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;

function validWitness(value: SupervisionPreflightInspectionV1): boolean {
  const admission = value.finalAdmission;
  const readiness = value.finalReadiness;
  const validTime = (time: string) => time.length <= 32 && Number.isFinite(Date.parse(time));
  return (
    value.schemaVersion === 1 &&
    value.kind === "work.supervision.preflight_inspection" &&
    ["admission", "readiness", "authority"].includes(value.failurePhase) &&
    CODE.test(value.reasonCode) &&
    (admission === null ||
      (HASH.test(admission.snapshotHash) &&
        validTime(admission.observedAt) &&
        [null, "admitted", "blocked"].includes(admission.disposition))) &&
    (readiness === null ||
      (HASH.test(readiness.observationHash) &&
        validTime(readiness.observedAt) &&
        validTime(readiness.validUntil) &&
        [readiness.failedCheckKinds, readiness.unobservedCheckKinds].every(
          (items) =>
            Array.isArray(items) &&
            items.length <= 16 &&
            new Set(items).size === items.length &&
            items.every((item) => CODE.test(item)),
        )))
  );
}

/** Records only the witnessed pre-effect boundary; it grants no replay or supersession. */
export async function recordSupervisionPreflightBlocked(input: {
  journal: SupervisionEventJournal;
  events: EventStore;
  findDecision(decisionId: string): SupervisionDecisionReceipt | null;
  receipt: SupervisionDecisionReceipt;
  plan: OperatingActionPlanV1;
  inspection: SupervisionPreflightInspectionV1;
}): Promise<string> {
  const { journal, events, plan } = input;
  const receipt = structuredClone(input.receipt);
  const inspection = structuredClone(input.inspection);
  const current = input.findDecision(receipt.decisionId);
  if (
    current === null ||
    current.status !== "recorded" ||
    receipt.status !== "recorded" ||
    current.planHash !== receipt.planHash ||
    receipt.decisionId !== operatingDecisionId(plan) ||
    receipt.planHash !== operatingContractHash(plan) ||
    !validWitness(inspection)
  )
    throw new Error("The preflight block is not bound to a recorded, unexecuted decision.");
  const decision = events.get(
    journal.eventId("work.supervision.decision.recorded", receipt.decisionId),
  );
  if (
    decision === null ||
    decision.payload.planHash !== receipt.planHash ||
    decision.payload.sourceRevisionDigest !== plan.sourceRevisionDigest ||
    decision.payload.mandateHash !== plan.mandateHash ||
    decision.payload.workstreamId !== plan.workstreamId
  )
    throw new Error("The preflight block differs from its canonical decision.");
  const inspectionArtifactHash = await journal.put({
    ...inspection,
    decisionId: receipt.decisionId,
    planHash: receipt.planHash,
  });
  const identity = operatingContractHash({
    decisionId: receipt.decisionId,
    inspectionArtifactHash,
  });
  const payload = {
    ...supervisionPayloadFromDecision(decision),
    decisionId: receipt.decisionId,
    planHash: receipt.planHash,
    effectContract: plan.effectContract,
    sourceRevisionDigest: plan.sourceRevisionDigest,
    inspectionArtifactHash,
    failurePhase: inspection.failurePhase,
    reasonCode: inspection.reasonCode,
  };
  journal.append(BLOCKED, payload, identity, () => {
    if (input.findDecision(receipt.decisionId)?.status !== "recorded")
      throw new Error("The decision changed before its preflight block was recorded.");
  });
  return journal.eventId(BLOCKED, identity);
}

export interface UnresolvedSupervisionPreflightBlock {
  eventId: string;
  eventHash: string;
  seq: number;
  supervisionId: string;
  decisionId: string;
  reasonCode: string;
  planHash: string;
  workstreamId: string;
}

/**
 * A superseded decision or a new successor goal does not repair its recorded blocker. Only a
 * confirmed effect of the same decision or an exact reviewed resolution event clears it.
 */
export function listUnresolvedSupervisionPreflightBlocks(input: {
  events: EventStore;
  coordinates: Pick<SupervisionJournalCoordinates, "projectId" | "ownerAgentId" | "supervisionId">;
}): UnresolvedSupervisionPreflightBlock[] {
  const { events, coordinates } = input;
  const unresolved = new Map<string, UnresolvedSupervisionPreflightBlock>();
  // Only these types change a block's state; reading them alone keeps the scan off unrelated history.
  for (const event of collectEventsOfTypesBounded({
    events,
    types: [BLOCKED, RESOLVED, "work.supervision.effect.observed"],
    maximumEvents: 100_000,
  })) {
    if (
      event.projectId !== coordinates.projectId ||
      event.payload.ownerAgentId !== coordinates.ownerAgentId ||
      typeof event.payload.supervisionId !== "string" ||
      lineageRootId(event.payload.supervisionId) !== lineageRootId(coordinates.supervisionId)
    )
      continue;
    if (event.type === BLOCKED) {
      if (
        event.schemaVersion !== 3 ||
        event.runId !==
          `run_${operatingContractHash({ supervisionId: event.payload.supervisionId }).slice(7, 39)}`
      )
        throw new Error("The preflight block has no exact supervision binding.");
      unresolved.set(event.eventId, {
        eventId: event.eventId,
        eventHash: event.eventHash,
        seq: event.seq,
        supervisionId: event.payload.supervisionId,
        decisionId: String(event.payload.decisionId),
        reasonCode: String(event.payload.reasonCode),
        planHash: String(event.payload.planHash),
        workstreamId: String(event.payload.workstreamId),
      });
    } else if (
      event.type === "work.supervision.effect.observed" &&
      event.payload.status === "effect_confirmed"
    ) {
      for (const [id, blocked] of unresolved)
        if (
          blocked.decisionId === event.payload.decisionId &&
          blocked.planHash === event.payload.planHash &&
          blocked.workstreamId === event.payload.workstreamId
        )
          unresolved.delete(id);
    } else if (event.type === RESOLVED) {
      const blocked = unresolved.get(String(event.payload.blockedEventId));
      if (blocked !== undefined && blocked.eventHash === event.payload.blockedEventHash)
        unresolved.delete(blocked.eventId);
    }
  }
  return [...unresolved.values()];
}

export function findUnresolvedSupervisionPreflightBlock(input: {
  events: EventStore;
  coordinates: SupervisionJournalCoordinates;
}): { eventId: string; decisionId: string; reasonCode: string } | null {
  const latest = listUnresolvedSupervisionPreflightBlocks(input).at(-1);
  return latest === undefined
    ? null
    : { eventId: latest.eventId, decisionId: latest.decisionId, reasonCode: latest.reasonCode };
}
