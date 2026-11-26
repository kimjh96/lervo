// The usage a hosted Claude Code session reports in its stream: each result's per-model amounts,
// for the core to record against the session (Lervo ADE sessions, "Core records").
import { type HostedTurnUsage, usageModelName } from "@lervo/adapter-contract";
import type { ResourceAccountingDescriptor } from "@lervo/schemas";
import { asRecord } from "./normalization-utils.js";

type Line = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const optionalCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const positiveCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;

/**
 * How Claude Code counts the usage this decoder reports: each result's per-model delta since the
 * previous result, from `model_usage_since_last_result`, or the turn's own `usage` from an older
 * Claude Code. The core stores this descriptor once before the first record citing it.
 */
export const CLAUDE_HOSTED_USAGE_ACCOUNTING: ResourceAccountingDescriptor = {
  kind: "resource_accounting_descriptor",
  schemaVersion: 2,
  provider: "claude",
  adapterId: "claude/hosted-session",
  adapterVersion: "1",
  accountingMode: "operation_delta",
  observationSupport: "supported",
  unavailableReason: null,
  normalizationId: "claude.hosted.result-usage.v1",
  nativeCounterSemanticsId: "claude.stream-json.model-usage-since-last-result.v1",
  requestedModel: null,
  serviceTier: null,
};

/**
 * A result's usage: one record per model from `model_usage_since_last_result`, whose amounts sum
 * to the process's cumulative totals, or, from an older Claude Code, one record from the turn's
 * `usage` without a cost. A result without a UUID, or without either, reports nothing.
 */
export function turnUsage(line: Line, lastModel: string | undefined): HostedTurnUsage[] {
  const turnKey = text(line.uuid);
  if (turnKey === undefined) return [];
  const resultIndex = count(line.result_index);
  const perModel = asRecord(line.model_usage_since_last_result);
  if (perModel !== undefined)
    return Object.entries(perModel).flatMap(([key, value]) => {
      const stats = asRecord(value);
      if (stats === undefined) return [];
      const cost =
        typeof stats.costUSD === "number" && Number.isFinite(stats.costUSD) && stats.costUSD >= 0
          ? stats.costUSD
          : null;
      return [
        {
          turnKey,
          resultIndex,
          modelKey: key,
          model: usageModelName(text(stats.canonicalModel) ?? key),
          uncachedInputTokens: count(stats.inputTokens),
          cacheReadInputTokens: count(stats.cacheReadInputTokens),
          cacheCreationInputTokens: count(stats.cacheCreationInputTokens),
          outputTokens: count(stats.outputTokens),
          reasoningOutputTokens: optionalCount(stats.thinkingTokens),
          contextWindow: positiveCount(stats.contextWindow),
          costUsd: cost,
          costBasis: cost === null ? ("unreported" as const) : ("list" as const),
        },
      ];
    });
  const usage = asRecord(line.usage);
  if (usage === undefined) return [];
  return [
    {
      turnKey,
      resultIndex,
      modelKey: lastModel ?? "",
      model: usageModelName(lastModel),
      uncachedInputTokens: count(usage.input_tokens),
      cacheReadInputTokens: count(usage.cache_read_input_tokens),
      cacheCreationInputTokens: count(usage.cache_creation_input_tokens),
      outputTokens: count(usage.output_tokens),
      reasoningOutputTokens: optionalCount(asRecord(usage.output_tokens_details)?.thinking_tokens),
      contextWindow: null,
      costUsd: null,
      costBasis: "unreported",
    },
  ];
}
