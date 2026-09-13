import { SupervisionArtifactReviewJournal } from "@lervo/agent-workforce";
import type {
  OperatingActionPlanV1,
  SupervisedArtifactReviewV1,
  SupervisedGoalCompletionV1,
} from "@lervo/application-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  assertSupervisedArtifactReview,
  assertSupervisedGoalCompletion,
} from "@lervo/work-controller";
import { inspectGoalCompletion } from "./supervision-goal-completion-receipt.js";
import type { NodeSupervisionEffectSession } from "./outcome-supervision-runtime.js";
import {
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

/** Applies only the exact versioned control effect; no provider or generic filesystem capability. */
export class SupervisionOwnerControlEffects {
  private readonly binding: NodeSupervisionBinding;
  constructor(
    private readonly repositoryRoot: string,
    binding: NodeSupervisionBinding,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
  }
  private async effect(storage: ProjectStorage, plan: OperatingActionPlanV1) {
    const effect = (await readSupervisionJsonArtifact(storage.artifacts, plan.effectHash)) as
      SupervisedArtifactReviewV1 | SupervisedGoalCompletionV1;
    if (effect.kind === "work.goal_completion") assertSupervisedGoalCompletion(effect, plan);
    else assertSupervisedArtifactReview(effect, plan);
    return effect;
  }
  async execute(plan: OperatingActionPlanV1, session: NodeSupervisionEffectSession) {
    const storage = await openProjectStorage(this.repositoryRoot);
    try {
      const effect = await this.effect(storage, plan);
      return effect.kind === "work.goal_completion"
        ? await session.recordGoalCompletion(plan, effect)
        : await session.recordArtifactReview(plan, effect);
    } finally {
      await storage.close();
    }
  }
  async inspect(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.repositoryRoot);
    try {
      const effect = await this.effect(storage, plan);
      if (effect.kind === "work.goal_completion")
        return await inspectGoalCompletion(storage, plan, effect);
      return await new SupervisionArtifactReviewJournal(
        storage.events,
        storage.artifacts,
        supervisionJournalCoordinates(storage, this.binding, 1),
        this.now,
        null,
      ).inspect(plan, effect);
    } finally {
      await storage.close();
    }
  }
}
