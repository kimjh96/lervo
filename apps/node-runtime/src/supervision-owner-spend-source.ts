import type { OperatingActionPlanV1, OperatingMandate } from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { budgetTokens, readResourceUsageEventPayload } from "@lervo/execution-contract";
import {
  assertOperatingActionPlan,
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
  ownerSpendAdmitsReservation,
  projectOwnerSpendAllowance,
} from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

type OwnerSpendScope = { projectId: string; ownerAgentId: string };

/** Rebuilds an owner's full-reservation epoch from a verified project event chain and exact plans. */
export async function readOwnerSpendAdmission(input: {
  mandate: OperatingMandate;
  plan: OperatingActionPlanV1;
  events: readonly EventEnvelope[];
  artifacts: ArtifactStore;
}): Promise<ReturnType<typeof projectOwnerSpendAllowance> | null> {
  const epoch = await readOwnerSpendEpoch({ ...input, scope: input.plan });
  return epoch === null
    ? null
    : projectOwnerSpendAllowance({ ...epoch, currentDecisionId: operatingDecisionId(input.plan) });
}

/** Whether the epoch can admit one more owner reservation; null when no allowance applies. */
export async function readOwnerSpendHeadroom(input: {
  mandate: OperatingMandate;
  scope: OwnerSpendScope;
  events: readonly EventEnvelope[];
  artifacts: ArtifactStore;
  nextReservedTokens: number;
}): Promise<boolean | null> {
  const epoch = await readOwnerSpendEpoch(input);
  return epoch === null
    ? null
    : ownerSpendAdmitsReservation({ ...epoch, nextReservedTokens: input.nextReservedTokens });
}

async function readOwnerSpendEpoch(input: {
  mandate: OperatingMandate;
  scope: OwnerSpendScope;
  events: readonly EventEnvelope[];
  artifacts: ArtifactStore;
}) {
  const { mandate, scope: plan, events, artifacts } = input;
  if (mandate.schemaVersion !== 3 || mandate.ownerSpendAllowance === undefined) return null;
  const allowance = mandate.ownerSpendAllowance;
  const anchor = events.find((event) => event.eventId === allowance.anchorEventId);
  if (
    allowance.projectId !== plan.projectId ||
    mandate.ownerAgentId !== plan.ownerAgentId ||
    anchor === undefined ||
    anchor.eventHash !== allowance.anchorEventHash ||
    anchor.type !== "work.supervision.mandate.revoked" ||
    anchor.projectId !== plan.projectId ||
    anchor.payload.ownerAgentId !== plan.ownerAgentId
  )
    throw new Error("The owner spend allowance does not bind an exact revocation anchor.");
  const reservations: {
    decisionId: string;
    reservedTokens: number;
    observedTokens: number | null;
    usageUnavailable: boolean;
  }[] = [];
  for (const event of events) {
    if (
      event.seq <= anchor.seq ||
      event.type !== "work.supervision.decision.recorded" ||
      event.projectId !== plan.projectId ||
      event.payload.ownerAgentId !== plan.ownerAgentId
    )
      continue;
    const recorded = (await readSupervisionJsonArtifact(
      artifacts,
      String(event.payload.planArtifactHash),
    )) as OperatingActionPlanV1;
    assertOperatingActionPlan(recorded);
    if (
      operatingContractHash(recorded) !== event.payload.planHash ||
      operatingDecisionId(recorded) !== event.payload.decisionId ||
      recorded.projectId !== event.projectId ||
      recorded.ownerAgentId !== plan.ownerAgentId ||
      recorded.mandateHash !== event.payload.mandateHash ||
      recorded.workstreamId !== event.payload.workstreamId
    )
      throw new Error("The owner spend decision differs from its exact recorded plan.");
    if (recorded.effectContract === "work.owner_reasoning.v1") {
      const runId = managedExecutionIdentity(
        recorded.projectId,
        operatingContractHash(recorded),
      ).runId;
      const receipts = events.filter(
        (item) => item.runId === runId && item.type === "resource.usage.recorded",
      );
      // A superseded decision whose run left no event at all never started a provider, so it
      // is charged nothing; any run event keeps the full reservation.
      const neverStarted =
        events.some(
          (item) =>
            item.type === "work.supervision.decision.superseded" &&
            item.payload.decisionId === event.payload.decisionId &&
            item.payload.planHash === event.payload.planHash,
        ) && !events.some((item) => item.runId === runId);
      if (receipts.length > 1)
        throw new Error("The owner spend decision has conflicting usage receipts.");
      const usage = receipts[0] === undefined ? null : readResourceUsageEventPayload(receipts[0]);
      if (
        (receipts.length === 1 && usage === null) ||
        (usage !== null &&
          (usage.source !== "provider_reported" ||
            usage.scope !== "primary_provider" ||
            receipts[0]!.actor.provider !== recorded.provider))
      )
        throw new Error("The owner spend usage differs from its provider decision.");
      reservations.push({
        decisionId: operatingDecisionId(recorded),
        reservedTokens: recorded.reservedTokens,
        observedTokens: neverStarted
          ? 0
          : usage?.status === "observed"
            ? budgetTokens(usage.usage!)
            : null,
        // A terminated turn could not outspend its reservation (the running limit enforces it),
        // so missing usage charges the full reservation; only a turn that may still run is
        // uncertain and blocks the epoch.
        usageUnavailable:
          usage?.status === "unavailable" &&
          !events.some(
            (item) =>
              item.runId === runId && (item.type === "run.failed" || item.type === "run.completed"),
          ),
      });
    }
  }
  return { allowance, reservations };
}
