import { describe, expect, it } from "vitest";

import { appliedInstructionsOf } from "../src/terminal-turn-observation.js";

const report = (
  status: "complete" | "incomplete" | "unavailable",
  prepared: number,
  omitted: number | null,
) => ({ status, preparedCount: prepared, omittedCount: omitted }) as never;

describe("the owner rules a prepared context counts", () => {
  it("copies the report's three counts from schema 15, and nothing below it", () => {
    expect(appliedInstructionsOf(report("incomplete", 2, 12), 15)).toEqual({
      status: "incomplete",
      preparedCount: 2,
      omittedCount: 12,
    });
    expect(appliedInstructionsOf(report("unavailable", 0, null), 16)).toEqual({
      status: "unavailable",
      preparedCount: 0,
      omittedCount: null,
    });
    expect(appliedInstructionsOf(report("complete", 3, 0), 14)).toBeUndefined();
    expect(appliedInstructionsOf(undefined, 16)).toBeUndefined();
  });
});
