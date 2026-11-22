import {
  knowledgeEffectPreflight,
  type KnowledgeEffectHold,
} from "@lervo/repository-knowledge-runtime";

/** The debt reason an upgrade stage shows for a held effect: the exact cause, not its class. */
export function knowledgeEffectHoldReason(hold: KnowledgeEffectHold): string {
  return hold.reason === "commit_unavailable" ? hold.detail : hold.reason;
}

/**
 * ADR-0610: why the knowledge stages wait as Lervo debt in this checkout now, or null when they
 * may commit. Their effects land only as commits on the base branch by the host that holds
 * convergence ownership, so off the base branch (`not_on_base`), on a host another host owns
 * convergence for (`convergence_owner_elsewhere`), or while ownership is unverifiable, they wait.
 * Plan and apply share this one answer, so a plan never shows a stage ready that its apply skips.
 */
export async function knowledgeStageWaitReason(repositoryRoot: string): Promise<string | null> {
  const hold = await knowledgeEffectPreflight(repositoryRoot, [], { generated: true });
  return hold === null ? null : knowledgeEffectHoldReason(hold);
}
