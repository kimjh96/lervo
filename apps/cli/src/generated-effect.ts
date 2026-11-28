import {
  applyCommittedKnowledgeEffect,
  GENERATED_EFFECT_CROSS_CHECK,
  knowledgeEffectPreflight,
  knowledgeEffectUndoCommand,
  KnowledgeEffectOwnerHoldError,
  KnowledgeEffectUncommittedError,
  staleGitIndexLockInstruction,
  type KnowledgeCommitResult,
  type KnowledgeEffectNotice,
} from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";

/** Why a foreground Lervo effect did not apply, as the same failures a cross-checked one names. */
export async function assertKnowledgeEffectApplicable(
  repositoryRoot: string,
  paths: readonly string[],
  planId: string,
  options: { generated?: boolean } = {},
): Promise<void> {
  const hold = await knowledgeEffectPreflight(repositoryRoot, paths, options);
  if (hold?.reason === "owner_hold")
    throw new CommandFailure(
      "repository_owner_hold",
      `Plan ${planId} was not applied, because the owner holds this repository; lervo repository release --root <repository> ends the hold.`,
      { planId },
    );
  if (hold?.reason === "commit_unavailable")
    throw new CommandFailure(
      "knowledge_effect_commit_unavailable",
      hold.detail === "not_on_base"
        ? `Plan ${planId} was not applied, because this checkout is not on its base branch; Lervo writes its own changes only there (ADR-0610), so it applies once the checkout is back on it.`
        : hold.lock !== undefined
          ? `Plan ${planId} was not applied. ${staleGitIndexLockInstruction(hold.lock)}`
          : `Plan ${planId} was not applied, because Lervo cannot commit it here (${hold.detail}) and an effect without its undo commit never applies.`,
      {
        planId,
        reason: hold.detail,
        ...(hold.lock === undefined
          ? {}
          : { path: hold.lock.path, ageSeconds: hold.lock.ageSeconds }),
      },
    );
  if (hold?.reason === "paths_uncommitted")
    throw new CommandFailure(
      "knowledge_effect_paths_uncommitted",
      `Plan ${planId} was not applied, because these paths hold uncommitted work that its commit and undo would capture: ${hold.paths.join(", ")}. Commit or stash them first.`,
      { planId, paths: hold.paths },
    );
}

/**
 * ADR-0610 for a generated-only plan: it needs no cross-check, but it still applies only on the
 * base branch over clean user paths and lands as its own `Lervo Knowledge` commit, so it never
 * stays as an uncommitted change in the owner's checkout.
 */
export async function applyGeneratedEffect<T>(input: {
  repositoryRoot: string;
  paths: readonly string[];
  notice: Omit<KnowledgeEffectNotice, "crossCheck">;
  apply(): Promise<T>;
}): Promise<{ receipt: T; commit: KnowledgeCommitResult; undo: string | null }> {
  await assertKnowledgeEffectApplicable(input.repositoryRoot, input.paths, input.notice.planId, {
    generated: true,
  });
  const { receipt, commit } = await applyCommittedKnowledgeEffect({
    repositoryRoot: input.repositoryRoot,
    paths: input.paths,
    notice: { ...input.notice, crossCheck: GENERATED_EFFECT_CROSS_CHECK },
    apply: input.apply,
    generated: true,
  }).catch((error: unknown) => {
    if (error instanceof KnowledgeEffectOwnerHoldError)
      throw new CommandFailure("repository_owner_hold", error.message, {
        planId: input.notice.planId,
      });
    if (error instanceof KnowledgeEffectUncommittedError)
      throw new CommandFailure("knowledge_effect_commit_failed", error.message, {
        planId: input.notice.planId,
      });
    throw error;
  });
  return {
    receipt,
    commit,
    undo: commit.status === "committed" ? knowledgeEffectUndoCommand(commit.after) : null,
  };
}

/** The notice line a generated effect prints after it applied. */
export function generatedEffectLine(result: {
  commit: KnowledgeCommitResult;
  undo: string | null;
}) {
  return result.commit.status === "committed"
    ? `Commit: ${result.commit.after}\nUndo: ${result.undo}`
    : "Nothing to commit: the generated paths are untracked or unchanged.";
}
