import {
  commitKnowledgeEffect,
  knowledgeEffectUndoCommand,
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
 * regenerates identically, so the caller does not retry it.
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
  const receipt = await input.apply(crossCheck);
  const commit = await commitKnowledgeEffect({
    repositoryRoot: input.repositoryRoot,
    paths: input.paths,
    notice: { ...input.notice, crossCheck: `${crossCheck.reviewer} agreed` },
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
