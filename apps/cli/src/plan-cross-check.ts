import { createNoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";
import {
  lifecyclePlanReviewVerdict,
  prepareLifecyclePlanCrossCheck,
  noCapabilityJsonInvocationStrategy,
} from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";
import {
  openFirstRoute,
  readHostSelection,
  reviewCallRoutes,
  startFailureCause,
  type ReadModelSelection,
} from "./model-role-routes.js";

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
  /** Unchanged files the plan derives its content from, shown to the reviewer as evidence. */
  evidencePaths?: readonly string[];
  /** Replaced only in tests. */
  readSelection?: ReadModelSelection;
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
 * produced the plan. The `review` role of the model selection (ADR-0612) chooses its provider,
 * model, and effort. Without a provider to ask, nothing is applied and the background resident
 * remains the path that reviews and applies the plan.
 */
export async function crossCheckPlan(input: PlanCrossCheckInput): Promise<PlanCrossCheckVerdict> {
  const routes = await reviewCallRoutes({
    repositoryRoot: input.repositoryRoot,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    selection: await (input.readSelection ?? readHostSelection)(),
  });
  if (routes.length === 0)
    throw new CommandFailure(
      "knowledge_cross_check_unavailable",
      "No provider is admitted for an independent cross-check, so nothing was applied. Pass --provider codex or --provider claude, or let the background knowledge resident review and apply the plan.",
    );
  const prepared = await prepareLifecyclePlanCrossCheck(input);
  const {
    route: { provider },
    opened: runner,
  } = await openFirstRoute(routes, ({ provider: routeProvider, ...route }) =>
    createNoCapabilityProviderJsonRunner({
      ...route,
      strategy: noCapabilityJsonInvocationStrategy(routeProvider),
      systemPrompt: prepared.systemPrompt,
      timeoutMs: CROSS_CHECK_TIMEOUT_MS,
    }),
  ).catch((error: unknown) => {
    throw new CommandFailure(
      "knowledge_cross_check_unavailable",
      `No provider the review role allows could start an independent cross-check (${routes.map((route) => route.provider).join(", ")}), so nothing was applied: ${startFailureCause(error)}`,
    );
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
