import { describe, expect, it } from "vitest";

import { ExecutionStageRecorder, ExecutionStageTimingError } from "../src/stage-timing.js";

function clock(values: bigint[]): () => bigint {
  let index = 0;
  return () => values[index++]!;
}

describe("execution stage timing", () => {
  it("uses monotonic deltas and aggregates repeated completed stages", async () => {
    const recorder = new ExecutionStageRecorder({
      clock: clock([0n, 2_500_000n, 4_000_000n, 5_250_000n]),
      coldState: "warm",
      budgets: { search: 10 },
    });

    await recorder.measure("search", null, async () => undefined);
    await recorder.measure("search", null, async () => undefined);

    expect(recorder.snapshot()).toEqual([
      {
        stageId: "search",
        parentStageId: null,
        durationMs: 3.75,
        budgetMs: 10,
        outcome: "completed",
        coldState: "warm",
      },
    ]);
  });

  it("retains the most severe outcome without changing a stage parent", async () => {
    const recorder = new ExecutionStageRecorder({
      clock: clock([0n, 1_000_000n, 2_000_000n, 4_000_000n]),
      coldState: "unknown",
    });
    await recorder.measure("total", null, async () => undefined);
    await expect(
      recorder.measure("search", "total", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");

    expect(recorder.snapshot().find((item) => item.stageId === "search")).toMatchObject({
      parentStageId: "total",
      outcome: "failed",
      durationMs: 2,
    });
  });

  it("rejects clock regression, duplicate active stages, and absent parents", () => {
    const regressed = new ExecutionStageRecorder({
      clock: clock([2n, 1n]),
      coldState: "cold",
    });
    const token = regressed.begin("search", null);
    expect(() => regressed.finish(token, "completed")).toThrowError(
      expect.objectContaining<Partial<ExecutionStageTimingError>>({ code: "clock_regressed" }),
    );

    const duplicate = new ExecutionStageRecorder({
      clock: clock([0n]),
      coldState: "cold",
    });
    duplicate.begin("selection", null);
    expect(() => duplicate.begin("selection", null)).toThrowError(
      expect.objectContaining<Partial<ExecutionStageTimingError>>({
        code: "stage_duplicate_active",
      }),
    );

    const absentParent = new ExecutionStageRecorder({
      clock: clock([0n, 1n]),
      coldState: "cold",
    });
    const child = absentParent.begin("search", "total");
    absentParent.finish(child, "completed");
    expect(() => absentParent.snapshot()).toThrowError(
      expect.objectContaining<Partial<ExecutionStageTimingError>>({ code: "stage_tree_invalid" }),
    );
  });
});
