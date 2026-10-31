import { describe, expect, it } from "vitest";
import { terminalHookFailureReasons, validateSchema } from "@lervo/schemas";
import { RepositorySnapshotError } from "@lervo/orchestrator";
import { TerminalStageObservation } from "../src/terminal-stage-observation.js";
import { budgetTerminalStages, terminalHookFailureReason } from "../src/terminal-hook-budget.js";
import { TerminalWorkspaceIsolationError } from "../src/terminal-workspace-contract.js";

function payload() {
  return new TerminalStageObservation(`sha256:${"a".repeat(64)}`).finalize(
    "tobs_failure1234",
    "Stop",
    "failed",
  ).payload;
}

describe("terminal stage failure contract", () => {
  it("reads older records without a reason and accepts only closed codes", () => {
    const historical = payload();
    expect(validateSchema("executionStagesObservedEventPayload", historical).valid).toBe(true);
    for (const failureReason of terminalHookFailureReasons)
      expect(
        validateSchema("executionStagesObservedEventPayload", { ...historical, failureReason })
          .valid,
      ).toBe(true);
    for (const failureReason of [
      "unknown_code",
      "/private/path",
      "error with token",
      { message: "private" },
    ])
      expect(
        validateSchema("executionStagesObservedEventPayload", { ...historical, failureReason })
          .valid,
      ).toBe(false);
  });

  it("can retry failed stage persistence without finishing the recorder twice", () => {
    const timing = new TerminalStageObservation(`sha256:${"b".repeat(64)}`);
    const first = timing.finalize("tobs_failure1234", "Stop", "completed");
    const retry = timing.finalize("tobs_failure1234", "Stop", "failed");
    expect(retry.payload.observationSetId).toBe(first.payload.observationSetId);
    expect(retry.payload.stages.find((item) => item.stageId === "total")?.outcome).toBe("failed");
    expect(first.payload.stages.find((item) => item.stageId === "total")?.outcome).toBe(
      "completed",
    );
  });

  it.each([
    ["ingress_integrity", "hook_input_invalid"],
    ["repository_discovery", "repository_discovery_failed"],
    ["lifecycle_inspection", "lifecycle_inspection_failed"],
    ["event_commit", "event_persistence_failed"],
    ["corpus_preparation", "knowledge_inspection_failed"],
    ["repository_snapshot", "repository_snapshot_failed"],
  ] as const)("maps %s errors to %s", async (stage, code) => {
    const timing = budgetTerminalStages(new TerminalStageObservation(`sha256:${"d".repeat(64)}`));
    await expect(
      timing.measure(stage, async () => {
        throw new Error("private cause");
      }),
    ).rejects.toMatchObject({ code });
  });

  it("classifies only typed snapshot causes and keeps untyped errors closed", () => {
    expect(terminalHookFailureReason(new RepositorySnapshotError("private"))).toBe(
      "repository_snapshot_failed",
    );
    expect(terminalHookFailureReason({ code: "/private/path" })).toBe("unexpected_error");
  });

  it("settles concurrent stage wrappers before finalizing failure telemetry", async () => {
    const timing = budgetTerminalStages(new TerminalStageObservation(`sha256:${"e".repeat(64)}`));
    const waiting = timing.measure("query_projection", () => new Promise(() => undefined));
    const failed = timing.measure("corpus_preparation", async () => {
      throw new Error("private scan detail");
    });
    await Promise.allSettled([waiting, failed]);
    await timing.settle?.();
    const observed = timing.finalize("tobs_failure1234", "UserPromptSubmit", "failed");
    expect(observed?.payload.stages.find((stage) => stage.stageId === "total")?.outcome).toBe(
      "failed",
    );
    expect(
      validateSchema("executionStagesObservedEventPayload", {
        ...observed!.payload,
        failureReason: "knowledge_inspection_failed",
      }).valid,
    ).toBe(true);
  });

  it("preserves an actual workspace isolation rejection across the budget boundary", async () => {
    const timing = budgetTerminalStages(new TerminalStageObservation(`sha256:${"c".repeat(64)}`));
    const error = new TerminalWorkspaceIsolationError("writer_lease_lost", "private detail");
    await expect(
      timing.measure("lifecycle_inspection", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
