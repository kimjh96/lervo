import type {
  OperatingActionPlanV1,
  SupervisedGoalCompletionV1,
} from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import {
  readSupervisionJsonArtifact,
  readSupervisionTextArtifact,
} from "./supervision-artifact-json.js";
import {
  expectedGoalCompletion,
  inspectGoalCompletion,
} from "./supervision-goal-completion-receipt.js";

/** Recovers the exact completed goal for a separate contextual publication judgement. */
export async function readAcceptedSupervisionGoal(
  storage: ProjectStorage,
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>,
) {
  if (source.workstream.status !== "completed") return null;
  const decisions = source.events
    .filter(
      (event) =>
        event.type === "work.supervision.decision.recorded" &&
        event.payload.workstreamId === source.workstream.workstreamId,
    )
    .reverse();
  for (const decision of decisions) {
    const plan = (await readSupervisionJsonArtifact(
      storage.artifacts,
      String(decision.payload.planArtifactHash),
    )) as OperatingActionPlanV1;
    if (plan.effectContract !== "work.goal_completion.v1") continue;
    const effect = (await readSupervisionJsonArtifact(
      storage.artifacts,
      plan.effectHash,
    )) as SupervisedGoalCompletionV1;
    const expected = await expectedGoalCompletion(storage, plan, effect);
    if (expected.snapshotHash !== source.workstreamHash) continue;
    const receipt = await inspectGoalCompletion(storage, plan, effect);
    if (receipt.status !== "confirmed")
      throw new Error("The completed goal lacks its canonical receipt.");
    return {
      completionPlanHash: String(decision.payload.planHash),
      completionEventId: expected.eventId,
      resultArtifactHash: effect.resultArtifactHash,
      text: await readSupervisionTextArtifact(storage.artifacts, effect.resultArtifactHash),
    };
  }
  throw new Error("The completed workstream has no admitted goal completion.");
}
