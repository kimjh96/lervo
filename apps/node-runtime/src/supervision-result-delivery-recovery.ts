import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { OperatingActionPlanV1, SupervisedResultDelivery } from "@lervo/application-contract";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readResultDeliveryReceipt } from "./supervision-result-delivery-receipt.js";

export type ResultReplayStatus = "absent" | "sending" | "unknown" | "rejected" | "delivered" | null;

/** Historical delivery queues govern only the exact completed snapshot they published. */
export function resultDeliveryTargetsCurrentSnapshot(
  completionEventId: unknown,
  workstreamHash: string,
  events: Pick<EventStore, "get">,
): boolean {
  return (
    typeof completionEventId === "string" &&
    events.get(completionEventId)?.payload.snapshotContentHash === workstreamHash
  );
}

export function hasExactRecoveryQueues(
  planHashes: readonly string[],
  replacementPlanHash?: string,
): boolean {
  return (
    planHashes.length === (replacementPlanHash === undefined ? 1 : 2) &&
    (replacementPlanHash === undefined || planHashes[1] === replacementPlanHash)
  );
}

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
  replacementPlanHash?: string;
}): Promise<boolean> {
  if (input.replayStatus === undefined || input.source.workstream.status !== "completed")
    return false;
  const queued = input.source.supervisionEvents.filter(
    (event) =>
      event.type === "work.supervision.delivery.queued" &&
      resultDeliveryTargetsCurrentSnapshot(
        event.payload.completionEventId,
        input.source.workstreamHash,
        input.events,
      ),
  );
  if (
    !hasExactRecoveryQueues(
      queued.map((event) => String(event.payload.planHash)),
      input.replacementPlanHash,
    )
  )
    return false;
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
    queuedCount: 1,
    workstreamCompleted: input.source.workstream.status === "completed",
    status: state.status,
    attempt: state.attempt,
    nextCheckAt: state.nextCheckAt,
    replay: input.replayStatus(outbound.outboundId),
  });
}
