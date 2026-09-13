import { describe, expect, it } from "vitest";
import { projectWorkExecutionReport } from "@lervo/execution-observability";
import { projectWorkstreamResources } from "../src/index.js";
import { causalityPayload, event, workstreamId } from "./fixtures.js";

function history() {
  const runId = `run_${"1".repeat(24)}`;
  const causal = { ...causalityPayload({ assignmentId: "unused" }), assignmentId: null };
  return [
    event(1, "work.causality.recorded", runId, causal),
    event(2, "adapter.started", runId, {}, "codex"),
    event(
      3,
      "resource.usage.recorded",
      runId,
      {
        workId: causal.workId,
        resourceObservationId: `ruo_${"2".repeat(24)}`,
        sourceCoordinateDigest: `sha256:${"3".repeat(64)}`,
        scope: "primary_provider",
        source: "provider_reported",
        accountingMode: "turn_cumulative",
        accountingDescriptorHash: `sha256:${"4".repeat(64)}`,
        status: "observed",
        usage: {
          inputTokens: 1053663,
          cachedInputTokens: 984320,
          outputTokens: 7194,
          reasoningOutputTokens: 2487,
          totalTokens: 1060857,
          contextWindow: 258400,
        },
        reasonCode: null,
      },
      "codex",
    ),
  ];
}

const projectors = {
  governed: (events: ReturnType<typeof history>) =>
    projectWorkstreamResources({ events, workstreamId }).groups,
  report: (events: ReturnType<typeof history>) =>
    projectWorkExecutionReport({
      events,
      projectId: events[0]!.projectId,
      workId: String(events[0]!.payload.workId),
    }).resources,
};

describe.each(Object.entries(projectors))("historical resource reading: %s", (_name, project) => {
  it("retains observed counters and the original payload without inventing model identity", () => {
    const events = history();
    const original = JSON.stringify(events);
    expect(JSON.stringify(project(events))).toContain('"totalTokens":1060857');
    expect(JSON.stringify(events)).toBe(original);
    expect(Object.hasOwn(events[2]!.payload, "modelIdentity")).toBe(false);
  });

  it("preserves unavailable usage", () => {
    const events = history();
    Object.assign(events[2]!.payload, {
      status: "unavailable",
      usage: null,
      reasonCode: "resource_observation_missing",
    });
    const result = JSON.stringify(project(events));
    expect(result).toContain("unavailable");
    expect(result).not.toContain('"totalTokens":0');
  });

  it.each([
    "version_1",
    "version_3",
    "non_provider",
    "explicit_null_model",
    "malformed_model",
    "unknown_field",
    "invalid_total",
    "invalid_cached_subset",
    "invalid_reasoning_subset",
    "missing_counter",
  ])("rejects %s instead of widening historical compatibility", (condition) => {
    const events = history();
    const observation = events[2]!;
    const usage = observation.payload.usage as Record<string, number>;
    switch (condition) {
      case "version_1":
        observation.schemaVersion = 1;
        break;
      case "version_3":
        observation.schemaVersion = 3;
        break;
      case "non_provider":
        observation.actor = { kind: "system" };
        break;
      case "explicit_null_model":
        observation.payload.modelIdentity = null;
        break;
      case "malformed_model":
        observation.payload.modelIdentity = { answerModel: "invented" };
        break;
      case "unknown_field":
        observation.payload.prompt = "private";
        break;
      case "invalid_total":
        usage.totalTokens = 0;
        break;
      case "invalid_cached_subset":
        usage.cachedInputTokens = usage.inputTokens! + 1;
        break;
      case "invalid_reasoning_subset":
        usage.reasoningOutputTokens = usage.outputTokens! + 1;
        break;
      case "missing_counter":
        delete usage.outputTokens;
    }
    expect(() => project(events)).toThrow(/resource observation/iu);
  });
});
