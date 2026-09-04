import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { renderFoundationPerformanceSummary } from "../performance/report-summary.mjs";

describe("foundation performance summary", () => {
  it("exposes independent acceptance decisions", () => {
    const summary = JSON.parse(
      renderFoundationPerformanceSummary({
        reportId: "perf_example",
        allProfilesPassed: false,
        profiles: [
          {
            profile: { profileId: "pf_example" },
            acceptanceStatus: "failed",
            budgetStatus: "passed",
            measurementEnvironment: { status: "unstable" },
            candidate: { durationMs: { p95: 120 } },
            failureReasons: ["measurement_environment_unstable"],
          },
        ],
      }),
    );

    assert.deepEqual(summary, {
      reportId: "perf_example",
      allProfilesPassed: false,
      profiles: [
        {
          profileId: "pf_example",
          acceptanceStatus: "failed",
          budgetStatus: "passed",
          measurementEnvironmentStatus: "unstable",
          candidateP95: 120,
          failureReasons: ["measurement_environment_unstable"],
        },
      ],
    });
  });
});
