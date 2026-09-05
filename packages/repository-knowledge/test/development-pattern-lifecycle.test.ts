import { describe, expect, it } from "vitest";

import {
  assertDevelopmentPatternSupersession,
  developmentPatternReviewTransitions,
} from "../src/index.js";

describe("development-pattern review transitions", () => {
  it("keeps initial review and terminal review decisions explicit", () => {
    expect(
      developmentPatternReviewTransitions({ currentState: "candidate", decision: "accept" }),
    ).toEqual([{ fromState: "candidate", toState: "reviewed" }]);
    expect(
      developmentPatternReviewTransitions({ currentState: "deferred", decision: "reject" }),
    ).toEqual([
      { fromState: "deferred", toState: "reviewed" },
      { fromState: "reviewed", toState: "rejected" },
    ]);
  });

  it("allows only exact supersession after review or promotion", () => {
    expect(
      developmentPatternReviewTransitions({ currentState: "reviewed", decision: "supersede" }),
    ).toEqual([{ fromState: "reviewed", toState: "superseded" }]);
    expect(
      developmentPatternReviewTransitions({ currentState: "promoted", decision: "supersede" }),
    ).toEqual([{ fromState: "promoted", toState: "superseded" }]);
    expect(() =>
      developmentPatternReviewTransitions({ currentState: "promoted", decision: "defer" }),
    ).toThrow(/permits only an exact supersession/u);
  });

  it("binds supersession to a distinct current owner of the same exact target", () => {
    const current = {
      patternId: `pattern_${"a".repeat(24)}`,
      state: "reviewed",
      targetKind: "portable_skill",
      targetPath: ".agents/skills/check/SKILL.md",
    };
    const replacement = { ...current, patternId: `pattern_${"b".repeat(24)}`, state: "candidate" };
    expect(() => assertDevelopmentPatternSupersession({ current, replacement })).not.toThrow();
    expect(() =>
      assertDevelopmentPatternSupersession({
        current,
        replacement: { ...replacement, targetPath: ".agents/skills/other/SKILL.md" },
      }),
    ).toThrow(/same exact target responsibility/u);
    expect(() => assertDevelopmentPatternSupersession({ current, replacement: undefined })).toThrow(
      /distinct current replacement/u,
    );
  });
});
