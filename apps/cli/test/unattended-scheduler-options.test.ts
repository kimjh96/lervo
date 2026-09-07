import { describe, expect, it } from "vitest";

import { parseLoopOptions } from "../src/loop-options.js";

describe("unattended scheduler options", () => {
  it("parses one explicitly authorized bounded schedule", () => {
    expect(
      parseLoopOptions(
        [
          "schedule",
          "--provider",
          "codex",
          "--write",
          "--poll-ms",
          "100",
          "--max-cycles",
          "4",
          "--max-runs",
          "2",
          "--kill-switch",
          ".lervo/state/custom.stop",
        ],
        "/repository",
      ),
    ).toMatchObject({
      action: "schedule",
      provider: "codex",
      pollIntervalMs: 100,
      maximumCycles: 4,
      maximumManagedRuns: 2,
      killSwitchPath: ".lervo/state/custom.stop",
    });
  });

  it("rejects implicit authority and unsafe or unbounded controls", () => {
    expect(() => parseLoopOptions(["schedule", "--provider", "codex"], "/repository")).toThrow(
      "--write",
    );
    expect(() =>
      parseLoopOptions(
        ["schedule", "--provider", "codex", "--write", "--poll-ms", "99"],
        "/repository",
      ),
    ).toThrow("outside its bound");
    expect(() =>
      parseLoopOptions(
        ["schedule", "--provider", "codex", "--write", "--kill-switch", "../stop"],
        "/repository",
      ),
    ).toThrow("repository-relative");
  });
});
