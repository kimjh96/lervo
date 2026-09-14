import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { OperatingActionPlanV1, SupervisedResultDelivery } from "@lervo/application-contract";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readResultDeliveryReceipt } from "./supervision-result-delivery-receipt.js";

export type ResultReplayStatus = "absent" | "sending" | "unknown" | "rejected" | "delivered" | null;

export function canReplaceExhaustedDelivery(input: {
  queuedCount: number;
  workstreamCompleted: boolean;
  status: "not_started" | "pending" | "failed" | "delivered";
  attempt: number;
  nextCheckAt: string | null;
  replay: ResultReplayStatus;
}): boolean {
  return (
    input.queuedCount === 1 &&
    input.workstreamCompleted &&
    input.status === "failed" &&
    input.attempt === 4 &&
    input.nextCheckAt === null &&
    input.replay === "absent"
  );
}

/** A second publication is safe only when the first exhausted before transport reservation. */
export async function inspectResultDeliveryRecovery(input: {
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  artifacts: ArtifactStore;
  events: EventStore;
  replayStatus?: (outboundId: string) => ResultReplayStatus;
}): Promise<boolean> {
  if (input.replayStatus === undefined || input.source.workstream.status !== "completed")
    return false;
  const queued = input.source.supervisionEvents.filter(
    (event) => event.type === "work.supervision.delivery.queued",
  );
  if (queued.length !== 1) return false;
  const plan = (await readSupervisionJsonArtifact(
    input.artifacts,
    String(queued[0]!.payload.planHash),
  )) as OperatingActionPlanV1;
  const effect = (await readSupervisionJsonArtifact(
    input.artifacts,
    plan.effectHash,
  )) as SupervisedResultDelivery;
  const state = await readResultDeliveryReceipt(input, plan, effect);
  const outbound = (await readSupervisionJsonArtifact(
    input.artifacts,
    effect.outboundArtifactHash,
  )) as { outboundId: string };
  return canReplaceExhaustedDelivery({
    queuedCount: queued.length,
    workstreamCompleted: input.source.workstream.status === "completed",
    status: state.status,
    attempt: state.attempt,
    nextCheckAt: state.nextCheckAt,
    replay: input.replayStatus(outbound.outboundId),
  });
}
