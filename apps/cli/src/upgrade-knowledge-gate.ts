import {
  knowledgeEffectPreflight,
  repositoryCommittable,
  type KnowledgeEffectHold,
} from "@lervo/repository-knowledge-runtime";

import type { KnowledgeStage } from "./upgrade-stage-inspection.js";

/** The debt reason an upgrade stage shows for a held effect: the exact cause, not its class. */
export function knowledgeEffectHoldReason(hold: KnowledgeEffectHold): string {
  return hold.reason === "commit_unavailable" ? hold.detail : hold.reason;
}

/**
 * ADR-0610: why the knowledge stage waits in this checkout now, or null when its effect may land.
 * Its effects land only as commits on the base branch by the host that holds convergence
 * ownership, so off the base branch (`not_on_base`), on a host another host owns convergence for
 * (`convergence_owner_elsewhere`), or while ownership is unverifiable, it waits. A generated-only
 * plan (`ready`) applies as is where there is no commit to protect, outside Git or before the
 * first commit; a reviewed plan always needs its undo commit. This is the preflight each effect
 * of the stage runs, so the apply skips the stage exactly where its effects would be refused.
 */
export async function knowledgeStageWaitReason(
  repositoryRoot: string,
  stage: Pick<KnowledgeStage, "status">,
): Promise<string | null> {
  const generated = stage.status === "ready";
  const hold = await knowledgeEffectPreflight(repositoryRoot, [], { generated });
  if (hold === null) return null;
  // Outside Git or before the first commit, a reviewed plan has no commit to land as.
  if (
    !generated &&
    hold.reason === "commit_unavailable" &&
    !(await repositoryCommittable(repositoryRoot))
  )
    return "repository_not_committable";
  return knowledgeEffectHoldReason(hold);
}

/**
 * The wait an apply skips the knowledge stage for, or null when it runs the stage. Only a stage
 * the plan would apply, now or once an earlier stage applied (`deferred`), or showed as debt for
 * this same wait, is skipped. A stage the plan showed
 * current, or as debt for another reason, runs as before, so its inspection still settles held
 * records.
 */
export async function knowledgeStageSkipReason(
  repositoryRoot: string,
  planned: Pick<KnowledgeStage, "disposition" | "status" | "reason">,
): Promise<string | null> {
  const applicable = planned.disposition === "safe_apply" || planned.disposition === "deferred";
  if (!applicable && planned.disposition !== "lervo_debt") return null;
  const wait = await knowledgeStageWaitReason(repositoryRoot, planned);
  return wait !== null && (applicable || planned.reason === wait) ? wait : null;
}
