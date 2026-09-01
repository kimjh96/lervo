import { describe, expect, it } from "vitest";

import {
  ResourceUsageAccumulator,
  resourceAccountingDescriptorHash,
} from "../src/resource-accounting.js";
import type { AdapterNormalizedEvent, ResourceAccountingDescriptor } from "@lervo/schemas";

const descriptor: ResourceAccountingDescriptor = {
  kind: "resource_accounting_descriptor",
  schemaVersion: 1,
  provider: "fixture",
  adapterId: "adapter_fixture",
  adapterVersion: "1.0.0",
  accountingMode: "turn_cumulative",
  observationSupport: "supported",
  unavailableReason: null,
  normalizationId: "fixture_usage_v1",
  nativeCounterSemanticsId: "fixture_cumulative_v1",
  model: null,
  serviceTier: null,
};

function usage(
  eventId: string,
  providerTurnId: string,
  inputTokens: number,
  outputTokens: number,
): AdapterNormalizedEvent {
  return {
    kind: "normalized_event",
    schemaVersion: 1,
    eventId,
    projectId: "prj_fixture001",
    runId: "run_fixture001",
    sessionId: "ses_fixture001",
    providerSessionId: "provider-session",
    type: "provider.usage.updated",
    occurredAt: "2026-09-01T00:00:00Z",
    payload: {
      providerTurnId,
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
      reasoningOutputTokens: 0,
      totalTokens: inputTokens + outputTokens,
      contextWindow: 128_000,
    },
  };
}

function accumulator(accountingMode = descriptor.accountingMode): ResourceUsageAccumulator {
  return new ResourceUsageAccumulator(
    { ...descriptor, accountingMode },
    {
      workId: "wrk_111111111111111111111111",
      runId: "run_fixture001",
      sessionId: "ses_fixture001",
      providerSessionId: "provider-session",
      scope: "primary_provider",
    },
  );
}

describe("resource accounting", () => {
  it("replaces repeated cumulative snapshots instead of double counting", () => {
    const ledger = accumulator();
    ledger.observe(usage("evt_fixture001", "turn-1", 10, 2));
    ledger.observe(usage("evt_fixture002", "turn-1", 10, 2));
    ledger.observe(usage("evt_fixture003", "turn-1", 15, 4));
    ledger.observe(usage("evt_fixture004", "turn-2", 3, 1));

    expect(ledger.finalize()).toMatchObject({
      status: "observed",
      reasonCode: null,
      usage: { inputTokens: 18, outputTokens: 5, totalTokens: 23 },
    });
  });

  it("marks cumulative regression as a typed invalid observation", () => {
    const ledger = accumulator();
    ledger.observe(usage("evt_fixture001", "turn-1", 10, 2));
    ledger.observe(usage("evt_fixture002", "turn-1", 9, 2));

    expect(ledger.finalize()).toMatchObject({
      status: "invalid",
      usage: null,
      reasonCode: "resource_counter_regressed",
    });
  });

  it("deduplicates operation deltas and rejects a contradictory event identity", () => {
    const ledger = accumulator("operation_delta");
    ledger.observe(usage("evt_fixture001", "turn-1", 10, 2));
    ledger.observe(usage("evt_fixture001", "turn-1", 10, 2));
    expect(ledger.finalize().usage?.totalTokens).toBe(12);

    ledger.observe(usage("evt_fixture001", "turn-1", 11, 2));
    expect(ledger.finalize()).toMatchObject({
      status: "invalid",
      reasonCode: "resource_observation_contradiction",
    });
  });

  it("hashes descriptor content deterministically", () => {
    expect(resourceAccountingDescriptorHash(descriptor)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(resourceAccountingDescriptorHash(structuredClone(descriptor))).toBe(
      resourceAccountingDescriptorHash(descriptor),
    );
  });
});
