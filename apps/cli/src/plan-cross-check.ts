import { createNoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";
import {
  lifecyclePlanReviewVerdict,
  prepareLifecyclePlanCrossCheck,
  readWorkerProviderSelection,
} from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";

/** A foreground command runs outside any hook; the check gets the same bound as grounding. */
const CROSS_CHECK_TIMEOUT_MS = 120_000;

export interface PlanCrossCheckInput {
  repositoryRoot: string;
  /** The provider the caller named; otherwise the provider the resident last admitted. */
  provider?: "codex" | "claude";
  /** The exact in-memory plan, content included; its hash binds the verdict. */
  plan: unknown;
  /** Every path the plan changes. */
  paths: readonly string[];
}

export interface PlanCrossCheckVerdict {
  verdict: "agree" | "disagree";
  rationale: string;
  /** Who judged the plan, for the notice. */
  reviewer: string;
}

/**
 * ADR-0561 step one for a foreground plan: the exact lifecycle plan review (ADR-0479) asked of a
 * fresh no-capability provider session, which shares no session or conversation with whatever
 * produced the plan. Without a provider to ask, nothing is applied and the background resident
 * remains the path that reviews and applies the plan.
 */
export async function crossCheckPlan(input: PlanCrossCheckInput): Promise<PlanCrossCheckVerdict> {
  const provider =
    input.provider ?? (await readWorkerProviderSelection(input.repositoryRoot))?.provider;
  if (provider === undefined)
    throw new CommandFailure(
      "knowledge_cross_check_unavailable",
      "No provider is admitted for an independent cross-check, so nothing was applied. Pass --provider codex or --provider claude, or let the background knowledge resident review and apply the plan.",
    );
  const prepared = await prepareLifecyclePlanCrossCheck(input);
  const runner = await createNoCapabilityProviderJsonRunner({
    provider,
    systemPrompt: prepared.systemPrompt,
    timeoutMs: CROSS_CHECK_TIMEOUT_MS,
  });
  const answer = await runner.resolve(prepared.request);
  let verdict: ReturnType<typeof lifecyclePlanReviewVerdict>;
  try {
    verdict = lifecyclePlanReviewVerdict(answer);
  } catch {
    // ADR-0604: a malformed answer is no verdict, so it is never read as a disagreement.
    throw new CommandFailure(
      "knowledge_cross_check_unavailable",
      `The independent cross-check (no-capability ${provider} session) returned an answer that breaks the review contract, so nothing was applied. Run the command again, or let the background knowledge resident review and apply the plan.`,
    );
  }
  return {
    verdict: verdict.approved ? "agree" : "disagree",
    rationale: verdict.rationale,
    reviewer: `no-capability ${provider} session`,
  };
}

export type CrossCheckPlan = typeof crossCheckPlan;
