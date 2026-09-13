import type { OperatingActionPlanV1, OperatingPolicyReviewV1 } from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  assertOperatingActionPlan,
  operatingContractHash,
  operatingDecisionId,
  isOwnerReasoningAbsence,
  isManagedExecutionAbsence,
  managedExecutionIdentity,
  managedExecutionAbsenceEventsMatch,
} from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

/** Reads exact immutable policy admission for a bounded owner control. */
export async function readAdmittedControlDecision(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
) {
  return readDecision(storage, plan, "current");
}

export async function readHistoricalOwnerDecision(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
) {
  return readDecision(storage, plan, "owner_reasoning_history");
}

export async function readHistoricalManagedDecision(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
) {
  return readDecision(storage, plan, "managed_execution_history");
}

async function readDecision(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
  purpose: "current" | "owner_reasoning_history" | "managed_execution_history",
) {
  assertOperatingActionPlan(plan);
  const runId = `run_${operatingContractHash({ supervisionId: plan.supervisionId }).slice(7, 39)}`;
  const identity = operatingDecisionId(plan);
  const decision = storage.events.get(
    `evt_${operatingContractHash({ runId, type: "work.supervision.decision.recorded", identity }).slice(7, 39)}`,
  );
  if (
    decision === null ||
    decision.projectId !== plan.projectId ||
    decision.runId !== runId ||
    decision.type !== "work.supervision.decision.recorded" ||
    decision.actor.kind !== "system" ||
    decision.schemaVersion !== 3 ||
    decision.payload.planHash !== operatingContractHash(plan) ||
    decision.payload.disposition !== "admitted" ||
    ["supervisionId", "workstreamId", "ownerAgentId", "mandateHash"].some(
      (key) => decision.payload[key] !== plan[key as keyof OperatingActionPlanV1],
    ) ||
    operatingContractHash(
      await readSupervisionJsonArtifact(
        storage.artifacts,
        String(decision.payload.planArtifactHash),
      ),
    ) !== operatingContractHash(plan)
  )
    throw new Error("The owner control requires its exact admitted owner decision.");
  const policy = (await readSupervisionJsonArtifact(
    storage.artifacts,
    String(decision.payload.policyReviewHash),
  )) as OperatingPolicyReviewV1;
  const { reviewHash, ...content } = policy;
  if (
    reviewHash !== operatingContractHash(content) ||
    policy.kind !== "operating_policy.review" ||
    policy.reviewMode !== "mandate_policy_v1" ||
    policy.reviewerPolicyId !== "lervo.operating-mandate.v1" ||
    policy.planHash !== operatingContractHash(plan) ||
    policy.decisionId !== identity ||
    policy.mandateHash !== plan.mandateHash ||
    policy.sourceRevisionDigest !== plan.sourceRevisionDigest ||
    policy.graphHash !== plan.graphHash ||
    policy.disposition !== "admitted" ||
    policy.reasonCodes.length !== 0
  )
    throw new Error("The owner control policy decision is stale or inconsistent.");
  const supersession = storage.events.get(
    `evt_${operatingContractHash({ runId, type: "work.supervision.decision.superseded", identity }).slice(7, 39)}`,
  );
  if (supersession !== null) {
    if (purpose === "current") throw new Error("The owner control policy decision was superseded.");
    const inspection = await readSupervisionJsonArtifact(
      storage.artifacts,
      String(supersession.payload.inspectionArtifactHash),
    );
    if (
      supersession.type !== "work.supervision.decision.superseded" ||
      supersession.schemaVersion !== 3 ||
      supersession.actor.kind !== "system" ||
      supersession.projectId !== plan.projectId ||
      supersession.runId !== runId ||
      supersession.seq <= decision.seq ||
      supersession.payload.decisionId !== identity ||
      supersession.payload.planHash !== operatingContractHash(plan) ||
      ["supervisionId", "workstreamId", "ownerAgentId", "mandateHash"].some(
        (key) => supersession.payload[key] !== plan[key as keyof OperatingActionPlanV1],
      ) ||
      inspection === null ||
      typeof inspection !== "object" ||
      Array.isArray(inspection) ||
      !(
        purpose === "owner_reasoning_history" ? isOwnerReasoningAbsence : isManagedExecutionAbsence
      )(
        inspection as Record<string, unknown>,
        plan,
        String(supersession.payload.sourceRevisionDigest),
      ) ||
      !(purpose === "managed_execution_history"
        ? managedExecutionAbsenceEventsMatch(
            inspection as Record<string, unknown>,
            plan,
            collectRunEventsBounded({
              events: storage.events,
              runId: managedExecutionIdentity(plan.projectId, operatingContractHash(plan)).runId,
              maximumEvents: 4096,
            }),
          )
        : collectRunEventsBounded({
            events: storage.events,
            runId: managedExecutionIdentity(plan.projectId, operatingContractHash(plan)).runId,
            maximumEvents: 4096,
          }).length === 0)
    )
      throw new Error("The superseded owner observation has inconsistent absence evidence.");
  }
  return { runId, identity, decision, superseded: supersession !== null };
}
