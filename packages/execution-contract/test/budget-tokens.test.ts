import { expect, it } from "vitest";

import { budgetTokens } from "../src/budget-tokens.js";

it("charges cached input reads at a tenth of their tokens", () => {
  // Kael's worker: 424,506 total, of which 317,135 were cached re-reads.
  expect(budgetTokens({ totalTokens: 424_506, cachedInputTokens: 317_135 })).toBe(139_085);
  expect(budgetTokens({ totalTokens: 1_000 })).toBe(1_000);
  expect(budgetTokens({ totalTokens: 100, cachedInputTokens: 500 })).toBe(10);
  expect(budgetTokens({ totalTokens: 100, cachedInputTokens: -5 })).toBe(100);
});
