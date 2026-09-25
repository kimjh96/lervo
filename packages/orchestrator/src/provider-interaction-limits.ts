import { budgetTokens } from "@lervo/execution-contract";
import type { AdapterNormalizedEvent } from "@lervo/schemas";

import { ManagedProviderRunError } from "./provider-run-types.js";

export interface ManagedProviderInteractionLimits {
  maximumToolCalls?: number;
  maximumCommandExecutions?: number;
  /** Bound on turn-cumulative provider tokens, including cached input, across the run. */
  maximumTotalTokens?: number;
}

const absoluteMaximumProviderInteractions = 10_000;

function bounded(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > absoluteMaximumProviderInteractions) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      `${label} must be between 0 and ${absoluteMaximumProviderInteractions}.`,
    );
  }
  return value;
}

export class ManagedProviderInteractionLimiter {
  private toolCalls = 0;
  private commandExecutions = 0;
  private readonly turnTokens = new Map<string, number>();

  constructor(limits: ManagedProviderInteractionLimits) {
    this.maximumToolCalls = bounded(
      limits.maximumToolCalls ?? absoluteMaximumProviderInteractions,
      "maximumToolCalls",
    );
    this.maximumCommandExecutions = bounded(
      limits.maximumCommandExecutions ?? absoluteMaximumProviderInteractions,
      "maximumCommandExecutions",
    );
    if (
      limits.maximumTotalTokens !== undefined &&
      (!Number.isSafeInteger(limits.maximumTotalTokens) || limits.maximumTotalTokens < 1)
    )
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "maximumTotalTokens must be a positive safe integer.",
      );
    this.maximumTotalTokens = limits.maximumTotalTokens ?? null;
  }

  private readonly maximumToolCalls: number;
  private readonly maximumCommandExecutions: number;
  private readonly maximumTotalTokens: number | null;

  observe(event: AdapterNormalizedEvent): void {
    if (event.type === "provider.tool.called") {
      this.toolCalls += 1;
      if (this.toolCalls > this.maximumToolCalls) {
        throw new ManagedProviderRunError(
          "provider_tool_limit_exceeded",
          `Provider tool calls exceeded the allowed maximum of ${this.maximumToolCalls}.`,
        );
      }
    }
    if (event.type === "provider.command.executed") {
      this.commandExecutions += 1;
      if (this.commandExecutions > this.maximumCommandExecutions) {
        throw new ManagedProviderRunError(
          "provider_command_limit_exceeded",
          `Provider command executions exceeded the allowed maximum of ${this.maximumCommandExecutions}.`,
        );
      }
    }
    if (
      (event.type === "provider.usage.updated" || event.type === "provider.usage.estimated") &&
      this.maximumTotalTokens !== null
    ) {
      // Both are turn-cumulative, so the largest value per turn bounds that turn's total.
      const payload = event.payload as {
        providerTurnId?: unknown;
        totalTokens?: unknown;
        cachedInputTokens?: unknown;
      };
      if (typeof payload.providerTurnId !== "string" || typeof payload.totalTokens !== "number")
        return;
      // Budgets charge cached re-reads at their cost, not as full input tokens.
      const charged = budgetTokens({
        totalTokens: payload.totalTokens,
        ...(typeof payload.cachedInputTokens === "number"
          ? { cachedInputTokens: payload.cachedInputTokens }
          : {}),
      });
      this.turnTokens.set(
        payload.providerTurnId,
        Math.max(this.turnTokens.get(payload.providerTurnId) ?? 0, charged),
      );
      let total = 0;
      for (const tokens of this.turnTokens.values()) total += tokens;
      if (total > this.maximumTotalTokens) {
        throw new ManagedProviderRunError(
          "provider_token_limit_exceeded",
          `Provider tokens exceeded the allowed maximum of ${this.maximumTotalTokens}.`,
        );
      }
    }
  }
}
