import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { createHash } from "node:crypto";
import type {
  OperatingActionPlanV1,
  SupervisedGoalCompletionV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { validateSchema, type WorkstreamSnapshot } from "@lervo/schemas";
import { assertSupervisedGoalCompletion, operatingContractHash } from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

/** Reconstructs a deterministic completion from immutable, admitted decision and predecessor bytes. */
export async function expectedGoalCompletion(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
  effect: SupervisedGoalCompletionV1,
) {
  assertSupervisedGoalCompletion(effect, plan);
  const { runId, identity, decision } = await readAdmittedControlDecision(storage, plan);
  if (decision.payload.workstreamRevision !== effect.workstreamRevision)
    throw new Error("The goal completion revision differs from its decision.");
  const original = (await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.workstreamSnapshotHash,
  )) as WorkstreamSnapshot;
  if (
    !validateSchema("workstreamSnapshot", original).valid ||
    original.workstreamId !== effect.workstreamId ||
    original.revision !== effect.workstreamRevision ||
    original.status !== "active" ||
    !plan.causationEventIds.some((id) => {
      const event = storage.events.get(id);
      return (
        event?.type === "workstream.snapshot.recorded" &&
        event.payload.snapshotContentHash === effect.workstreamSnapshotHash &&
        event.seq < decision.seq
      );
    })
  )
    throw new Error("The goal completion predecessor is not canonical.");
  const snapshot: WorkstreamSnapshot = {
    ...original,
    status: "completed",
    revision: original.revision + 1,
    nextActions: [],
    updatedAt: effect.completedAt,
  };
  const snapshotContent = `${canonicalJson(snapshot)}\n`;
  const snapshotHash = `sha256:${createHash("sha256").update(snapshotContent).digest("hex")}`;
  const eventId = `evt_${operatingContractHash({ runId, type: "workstream.snapshot.recorded", identity }).slice(7, 39)}`;
  const payload = {
    workstreamId: effect.workstreamId,
    revision: snapshot.revision,
    status: "completed",
    changeKind: "agent_update",
    snapshotArtifactId: `art_${snapshotHash.slice(7)}`,
    snapshotContentHash: snapshotHash,
    previousSnapshotContentHash: effect.workstreamSnapshotHash,
    sourceArtifactId: null,
    sourceContentHash: null,
    recordedAt: effect.completedAt,
  };
  return { decision, eventId, runId, snapshot, snapshotContent, snapshotHash, payload };
}

export async function inspectGoalCompletion(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
  effect: SupervisedGoalCompletionV1,
) {
  const expected = await expectedGoalCompletion(storage, plan, effect);
  const event = storage.events.get(expected.eventId);
  if (event === null) return { status: "not_started" as const };
  if (
    event.projectId !== plan.projectId ||
    event.type !== "workstream.snapshot.recorded" ||
    event.runId !== expected.runId ||
    event.actor.kind !== "system" ||
    event.schemaVersion !== 3 ||
    event.seq <= expected.decision.seq ||
    operatingContractHash(event.payload) !== operatingContractHash(expected.payload) ||
    operatingContractHash(
      await readSupervisionJsonArtifact(storage.artifacts, expected.snapshotHash),
    ) !== operatingContractHash(expected.snapshot)
  )
    throw new Error("The goal completion receipt conflicts with its decision.");
  return { status: "confirmed" as const, eventIds: [event.eventId] };
}
