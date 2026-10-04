import { readResourceUsageEventPayload } from "@lervo/execution-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { DeliberationPolicy, ResourceUsageRecordedEventPayload } from "@lervo/schemas";

import { ManagedDeliberationError } from "./managed-deliberation-errors.js";

export interface ManagedDeliberationBudgetUsage {
  providerCalls: number;
  observedTokens: number;
  startedAt: string;
}

/**
 * Only complete usage of the expected scope counts: a partial, unavailable, or invalid record,
 * or usage from another scope in the same run, is not an exact observation of this provider call.
 * Distinct observations are summed; a replayed observation of the same identity counts once.
 */
export function observedRunTokens(
  events: ReturnType<ProjectStorage["events"]["list"]>,
  scope: ResourceUsageRecordedEventPayload["scope"],
): number | null {
  const observations = new Map<string, number>();
  for (const event of events) {
    const payload = readResourceUsageEventPayload(event);
    if (payload === null || payload.scope !== scope || payload.status !== "observed") continue;
    if (payload.usage === null) continue;
    const previous = observations.get(payload.resourceObservationId);
    observations.set(
      payload.resourceObservationId,
      Math.max(previous ?? 0, payload.usage.totalTokens),
    );
  }
  if (observations.size === 0) return null;
  return [...observations.values()].reduce((total, tokens) => total + tokens, 0);
}

export class ManagedDeliberationBudgetController {
  private providerCalls: number;
  private observedTokens: number;
  private readonly startedAt: string;

  constructor(
    private readonly events: Pick<ProjectStorage["events"], "list">,
    private readonly budget: NonNullable<DeliberationPolicy["executionBudget"]>,
    private readonly now: () => Date,
    initial?: ManagedDeliberationBudgetUsage,
  ) {
    this.providerCalls = initial?.providerCalls ?? 0;
    this.observedTokens = initial?.observedTokens ?? 0;
    this.startedAt = initial?.startedAt ?? this.now().toISOString();
  }

  usage(): ManagedDeliberationBudgetUsage {
    return {
      providerCalls: this.providerCalls,
      observedTokens: this.observedTokens,
      startedAt: this.startedAt,
    };
  }

  admit(finalizationReserveMs = 0): number {
    if (!Number.isSafeInteger(finalizationReserveMs) || finalizationReserveMs < 0) {
      throw new TypeError("The deliberation finalization reserve must be a non-negative integer.");
    }
    if (this.providerCalls >= this.budget.maximumProviderCalls) {
      throw new ManagedDeliberationError(
        "deliberation_budget_exhausted",
        `The deliberation reached its provider-call limit of ${this.budget.maximumProviderCalls}.`,
      );
    }
    if (this.observedTokens >= this.budget.maximumObservedTokens) {
      throw new ManagedDeliberationError(
        "deliberation_budget_exhausted",
        `The deliberation reached its observed-token limit of ${this.budget.maximumObservedTokens}.`,
      );
    }
    const remainingElapsedMs = this.remainingElapsedMs();
    if (remainingElapsedMs <= finalizationReserveMs) throw this.elapsedError();
    this.providerCalls += 1;
    return remainingElapsedMs - finalizationReserveMs;
  }

  observeCompletedRun(
    runId: string,
    scope: ResourceUsageRecordedEventPayload["scope"] = "deliberation",
  ): void {
    const totalTokens = observedRunTokens(this.events.list({ runId }), scope);
    if (totalTokens === null) {
      throw new ManagedDeliberationError(
        "deliberation_budget_observation_unavailable",
        "The deliberation cannot continue because exact provider token usage was not observed.",
      );
    }
    this.observedTokens += totalTokens;
    if (
      this.observedTokens >= this.budget.maximumObservedTokens ||
      this.remainingElapsedMs() <= 0
    ) {
      throw new ManagedDeliberationError(
        "deliberation_budget_exhausted",
        "The completed provider run reached the deliberation execution budget.",
      );
    }
  }

  elapsedError(cause?: unknown): ManagedDeliberationError {
    return new ManagedDeliberationError(
      "deliberation_budget_exhausted",
      `The deliberation reached its elapsed-time limit of ${this.budget.maximumElapsedMs} ms.`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }

  private remainingElapsedMs(): number {
    return (
      this.budget.maximumElapsedMs - Math.max(0, this.now().getTime() - Date.parse(this.startedAt))
    );
  }
}
