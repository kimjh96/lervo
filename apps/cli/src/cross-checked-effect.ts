import {
  applyCommittedKnowledgeEffect,
  knowledgeEffectPreflight,
  knowledgeEffectUndoCommand,
  KnowledgeEffectUncommittedError,
  type KnowledgeCommitResult,
  type KnowledgeEffectNotice,
} from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";
import type { CrossCheckPlan, PlanCrossCheckVerdict } from "./plan-cross-check.js";

export interface CrossCheckedEffectReport {
  crossCheck: PlanCrossCheckVerdict;
  commit: KnowledgeCommitResult;
  /** The one command that undoes the effect, or null when no commit holds it. */
  undo: string | null;
}

/**
 * ADR-0561 for a foreground plan that changes user-owned bytes: an independent cross-check, then
 * the effect, then its own `Lervo Knowledge` commit as the undo point. A disagreement changes
 * nothing and is reported to the caller; it never becomes an owner decision. A deterministic plan
 * regenerates identically, so the caller does not retry it. Nothing applies when the commit is
 * impossible or a user path the plan touches holds uncommitted work, and a commit that does not
 * land restores every changed path, so no effect is left without its undo.
 */
export async function applyCrossCheckedEffect<T>(input: {
  crossCheckPlan: CrossCheckPlan;
  repositoryRoot: string;
  provider?: "codex" | "claude";
  plan: unknown;
  paths: readonly string[];
  notice: Omit<KnowledgeEffectNotice, "crossCheck">;
  apply(crossCheck: PlanCrossCheckVerdict): Promise<T>;
}): Promise<{ receipt: T; report: CrossCheckedEffectReport }> {
  const hold = await knowledgeEffectPreflight(input.repositoryRoot, input.paths);
  if (hold?.reason === "commit_unavailable")
    throw new CommandFailure(
      "knowledge_effect_commit_unavailable",
      `Plan ${input.notice.planId} was not applied, because Lervo cannot commit it here (${hold.detail}) and an effect without its undo commit never applies.`,
      { planId: input.notice.planId },
    );
  if (hold?.reason === "paths_uncommitted")
    throw new CommandFailure(
      "knowledge_effect_paths_uncommitted",
      `Plan ${input.notice.planId} was not applied, because these paths hold uncommitted work that its commit and undo would capture: ${hold.paths.join(", ")}. Commit or stash them first.`,
      { planId: input.notice.planId, paths: hold.paths },
    );
  const crossCheck = await input.crossCheckPlan({
    repositoryRoot: input.repositoryRoot,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    plan: input.plan,
    paths: input.paths,
  });
  if (crossCheck.verdict !== "agree")
    throw new CommandFailure(
      "knowledge_cross_check_disagreed",
      `An independent cross-check (${crossCheck.reviewer}) disagreed with plan ${input.notice.planId}, so nothing was changed: ${crossCheck.rationale}`,
      { planId: input.notice.planId, reviewer: crossCheck.reviewer },
    );
  const { receipt, commit } = await applyCommittedKnowledgeEffect({
    repositoryRoot: input.repositoryRoot,
    paths: input.paths,
    notice: { ...input.notice, crossCheck: `${crossCheck.reviewer} agreed` },
    apply: () => input.apply(crossCheck),
  }).catch((error: unknown) => {
    if (error instanceof KnowledgeEffectUncommittedError)
      throw new CommandFailure("knowledge_effect_commit_failed", error.message, {
        planId: input.notice.planId,
      });
    throw error;
  });
  return {
    receipt,
    report: {
      crossCheck,
      commit,
      undo: commit.status === "committed" ? knowledgeEffectUndoCommand(commit.after) : null,
    },
  };
}

/** The after-the-fact notice lines a foreground effect prints: what agreed and how to undo it. */
export function crossCheckedEffectLines(report: CrossCheckedEffectReport): string[] {
  return [
    `Cross-check: ${report.crossCheck.reviewer} agreed.`,
    report.commit.status === "committed"
      ? `Commit: ${report.commit.after}\nUndo: ${report.undo}`
      : `Not committed (${report.commit.reason}); undo by restoring the changed paths from Git.`,
  ];
}
