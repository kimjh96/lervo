import { describe, expect, it } from "vitest";
import { resourceAccountingDescriptorHash } from "@lervo/execution-contract";
import type { ResourceAccountingDescriptor } from "@lervo/schemas";
import { comparableSupervisionResourceTotal, projectWorkstreamResources } from "../src/index.js";
import { causalityPayload, event, workstreamId } from "./fixtures.js";

function fixture() {
  const descriptors = new Map<string, ResourceAccountingDescriptor>();
  const events = [null, "fixture"].flatMap((requestedModel, index) => {
    const descriptor: ResourceAccountingDescriptor = {
      schemaVersion: 2,
      kind: "resource_accounting_descriptor",
      provider: "codex",
      adapterId: "lervo/codex",
      adapterVersion: "0.1.0",
      accountingMode: "turn_cumulative",
      observationSupport: "supported",
      unavailableReason: null,
      normalizationId: "fixture_v1",
      nativeCounterSemanticsId: "fixture_cumulative_v1",
      requestedModel,
      serviceTier: null,
    };
    const hash = resourceAccountingDescriptorHash(descriptor);
    descriptors.set(hash, descriptor);
    const runId = `run_${String(index + 1).repeat(24)}`;
    const causal = {
      ...causalityPayload({ assignmentId: "unused" }),
      workId: `wrk_${String(index + 1).repeat(24)}`,
      assignmentId: null,
    };
    return [
      event(index * 3 + 1, "work.causality.recorded", runId, causal),
      event(index * 3 + 2, "adapter.started", runId, {}, "codex"),
      event(
        index * 3 + 3,
        "resource.usage.recorded",
        runId,
        {
          workId: causal.workId,
          resourceObservationId: `ruo_${String(index + 1).repeat(24)}`,
          sourceCoordinateDigest: `sha256:${String(index + 1).repeat(64)}`,
          scope: "primary_provider",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: hash,
          status: "observed",
          reasonCode: null,
          modelIdentity: {
            provider: "codex",
            requestedModel,
            answerModel: "fixture",
            observedModelIds: ["fixture"],
            answerModelEvidence: "thread_start",
            unavailableReason: null,
          },
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 4,
            reasoningOutputTokens: 0,
            totalTokens: 14,
            contextWindow: 200000,
          },
        },
        "codex",
      ),
    ];
  });
  return { ...projectWorkstreamResources({ events, workstreamId }), events, descriptors };
}

describe("supervision default-model accounting proof", () => {
  it("proves compatible observed models without merging or changing exact groups", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    expect(input.groups).toHaveLength(2);
    expect(comparableSupervisionResourceTotal(input)).toBe(28);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["provider", "scope", "accountingMode", "completeness", "runCount", "totalTokens"])(
    "rejects different or incomplete group %s",
    (key) => {
      const input = fixture();
      Object.assign(input.groups[1]!, {
        [key]: {
          provider: "claude",
          scope: "subagent",
          accountingMode: "operation_delta",
          completeness: "partial",
          runCount: 2,
          totalTokens: 15,
        }[key],
      });
      expect(comparableSupervisionResourceTotal(input)).toBeNull();
    },
  );

  it.each(["adapterVersion", "normalizationId", "nativeCounterSemanticsId", "serviceTier"])(
    "rejects actual descriptor differences in %s",
    (key) => {
      const input = fixture();
      const group = input.groups[1]!;
      const previous = group.accountingDescriptorHash;
      const descriptor = { ...input.descriptors.get(previous)!, [key]: "different" };
      group.accountingDescriptorHash = resourceAccountingDescriptorHash(descriptor);
      input.descriptors.set(group.accountingDescriptorHash, descriptor);
      for (const record of input.events)
        if (record.payload.accountingDescriptorHash === previous)
          record.payload.accountingDescriptorHash = group.accountingDescriptorHash;
      expect(comparableSupervisionResourceTotal(input)).toBeNull();
    },
  );

  it.each([
    { answerModel: null, answerModelEvidence: "unavailable", unavailableReason: "model_unknown" },
    { answerModel: "different", observedModelIds: ["different"] },
    { observedModelIds: ["fixture", "different"] },
    { requestedModel: "alias" },
  ])("rejects missing, mixed, different or aliased model identity %j", (change) => {
    const input = fixture();
    const payload = input.events[2]!.payload;
    payload.modelIdentity = { ...(payload.modelIdentity as object), ...change };
    expect(comparableSupervisionResourceTotal(input)).toBeNull();
  });

  it("rejects missing runs, duplicate observations and forged totals", () => {
    const input = fixture();
    expect(
      comparableSupervisionResourceTotal({ ...input, runIds: [...input.runIds, "missing"] }),
    ).toBeNull();
    expect(
      comparableSupervisionResourceTotal({ ...input, events: input.events.slice(1, 5) }),
    ).toBeNull();
    expect(
      comparableSupervisionResourceTotal({ ...input, events: [...input.events, input.events[2]!] }),
    ).toBeNull();
    expect(comparableSupervisionResourceTotal({ ...input, descriptors: new Map() })).toBeNull();
    input.groups[0]!.totalTokens = Number.MAX_SAFE_INTEGER + 1;
    expect(comparableSupervisionResourceTotal(input)).toBeNull();
  });
});
