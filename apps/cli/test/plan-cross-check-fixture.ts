import type { CliServiceOverrides } from "../src/main.js";
import type { PlanCrossCheckInput } from "../src/plan-cross-check.js";

/** An independent cross-check fake for foreground plans; it records every plan it judged. */
export function planCrossCheck(verdict: "agree" | "disagree" = "agree"): {
  services: CliServiceOverrides;
  checked: PlanCrossCheckInput[];
} {
  const checked: PlanCrossCheckInput[] = [];
  return {
    checked,
    services: {
      crossCheckPlan: async (input) => {
        checked.push(input);
        return {
          verdict,
          rationale:
            verdict === "agree"
              ? "The exact plan preserves every user-owned byte, link, and document identity."
              : "The plan drops a section of the source document without carrying it elsewhere.",
          reviewer: "fixture no-capability session",
        };
      },
    },
  };
}

/** Agreement for tests that only need a reviewed plan to apply. */
export const agreeingCrossCheck = planCrossCheck("agree").services;
