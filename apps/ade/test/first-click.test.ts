import { describe, expect, it } from "vitest";

import { reachedPage } from "../src/platform/first-click";

describe("the first click", () => {
  it("treats a press near the activation as the same click, so it never presses twice", () => {
    expect(reachedPage(1000, 990)).toBe(true);
    expect(reachedPage(1000, 1120)).toBe(true);
    expect(reachedPage(1000, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(reachedPage(1000, 300)).toBe(false);
  });
});
