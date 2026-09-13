import type {
  OperatingActionPlanV1,
  OutcomeSupervisionSnapshotV1,
  SupervisedResultDelivery,
} from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readResultDeliveryReceipt } from "./supervision-result-delivery-receipt.js";

export async function observeResultDelivery(input: {
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  artifacts: ArtifactStore;
  events: EventStore;
  now: string;
}): Promise<Pick<OutcomeSupervisionSnapshotV1, "delivery" | "deliveryNextCheckAt">> {
  const queued = input.source.supervisionEvents.findLast(
    (event) => event.type === "work.supervision.delivery.queued",
  );
  if (queued === undefined) return { delivery: "not_attempted" };
  if (
    input.events.get(String(queued.payload.completionEventId))?.payload.snapshotContentHash !==
    input.source.workstreamHash
  )
    return { delivery: "not_attempted" };
  const plan = (await readSupervisionJsonArtifact(
    input.artifacts,
    String(queued.payload.planHash),
  )) as OperatingActionPlanV1;
  const effect = (await readSupervisionJsonArtifact(
    input.artifacts,
    plan.effectHash,
  )) as SupervisedResultDelivery;
  const state = await readResultDeliveryReceipt(input, plan, effect);
  if (state.status === "not_started") throw new Error("The result delivery queue is unbound.");
  if (state.status === "delivered") return { delivery: "delivered" };
  const next = Date.parse(input.now) < Date.parse(plan.deadline) ? state.nextCheckAt : null;
  return { delivery: next === null ? "failed" : "pending", deliveryNextCheckAt: next };
}
