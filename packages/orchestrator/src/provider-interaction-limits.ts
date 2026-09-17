import type { AdapterNormalizedEvent } from "@lervo/schemas";

import { ManagedProviderRunError } from "./provider-run-types.js";

export interface ManagedProviderInteractionLimits {
  maximumToolCalls: number;
  maximumCommandExecutions: number;
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

  constructor(limits: ManagedProviderInteractionLimits) {
    this.maximumToolCalls = bounded(limits.maximumToolCalls, "maximumToolCalls");
    this.maximumCommandExecutions = bounded(
      limits.maximumCommandExecutions,
      "maximumCommandExecutions",
    );
  }

  private readonly maximumToolCalls: number;
  private readonly maximumCommandExecutions: number;

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
  }
}
