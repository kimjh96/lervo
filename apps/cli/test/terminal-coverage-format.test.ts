import { describe, expect, it } from "vitest";
import type { TerminalCoverageReport } from "@lervo/diagnostics";

import { formatTerminalCoverageReport } from "../src/terminal-coverage-format.js";

describe("terminal coverage format", () => {
  it("separates unavailable whole-task usage from observed query projection usage", () => {
    const report = {
      reports: [
        {
          provider: "codex",
          occurredAt: "2026-09-01T00:00:00.000Z",
          documents: [],
          selectedCount: 2,
          referenceCount: 1,
          pathMentionCount: 1,
          coverage: {
            explicitReference: { numerator: 0, denominator: 0, value: null, reason: "unavailable" },
          },
          completion: { result: "not_observed" },
          resources: {
            wholeTask: { reasonCode: "unmanaged_provider_usage_unobserved" },
            queryProjection: {
              status: "partial",
              reasonCode: "accounting_descriptor_unavailable",
              usage: { totalTokens: 8 },
            },
          },
          stages: {
            completeness: "unavailable",
            missingReasons: ["stage_observation_missing"],
            observations: [],
          },
        },
      ],
    } as unknown as TerminalCoverageReport;

    const formatted = formatTerminalCoverageReport(report);
    expect(formatted).toContain("whole-task=unmanaged_provider_usage_unobserved");
    expect(formatted).toContain(
      "query-projection=8 tokens (partial: accounting_descriptor_unavailable)",
    );
    expect(formatted).toContain("not billed cost");
    expect(formatted).toContain("selected=2; references=1; path-mentions=1 (proxy)");
    expect(formatted).toContain("do not prove reading or reliance");
  });
});
