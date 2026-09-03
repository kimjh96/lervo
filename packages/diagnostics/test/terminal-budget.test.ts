import { describe, expect, it } from "vitest";

import type { TerminalCoverageReport } from "@lervo/schemas";

import { createTerminalBudgetReport } from "../src/index.js";

function coverage(input: {
  promptDurations: number[];
  environmentDigests?: string[];
  queryTokens?: Array<number | null>;
}): TerminalCoverageReport {
  return {
    schemaVersion: 1,
    reportKind: "unmanaged_terminal_context",
    projectId: "prj_terminal_budget",
    reports: input.promptDurations.map((duration, index) => {
      const stage = (hookEvent: "UserPromptSubmit" | "Stop", durationMs: number) => ({
        hookEvent,
        observationSetId: `stgobs_${String(index + 1)
          .repeat(24)
          .slice(0, 24)}`,
        environmentProfileDigest: input.environmentDigests?.[index] ?? `sha256:${"a".repeat(64)}`,
        repositoryProfile: "small" as const,
        stages: [
          {
            stageId: "total" as const,
            parentStageId: null,
            durationMs,
            budgetMs: null,
            outcome: "completed" as const,
            coldState: "warm" as const,
          },
        ],
      });
      const queryTokens = input.queryTokens?.[index] ?? 8;
      return {
        provider: "codex" as const,
        contextEventId: `evt_budget_${String(index + 1).padStart(8, "0")}`,
        completedAt: "2026-09-03T00:00:01.000Z",
        stages: {
          completeness: "complete" as const,
          missingReasons: [],
          observations: [stage("UserPromptSubmit", duration), stage("Stop", duration / 2)],
        },
        resources: {
          queryProjection:
            queryTokens === null
              ? {
                  status: "unavailable" as const,
                  usage: null,
                  reasonCode: "query_projection_usage_unavailable",
                }
              : {
                  status: "partial" as const,
                  usage: {
                    inputTokens: queryTokens,
                    cachedInputTokens: 0,
                    outputTokens: 0,
                    reasoningOutputTokens: 0,
                    totalTokens: queryTokens,
                    contextWindow: null,
                  },
                  reasonCode: "accounting_descriptor_unavailable",
                },
        },
      };
    }),
  } as unknown as TerminalCoverageReport;
}

describe("terminal budget projection", () => {
  it("evaluates profile p95 and exact per-context query thresholds separately", () => {
    const report = createTerminalBudgetReport({
      coverage: coverage({ promptDurations: [10, 20], queryTokens: [8, 12] }),
      policy: { minimumSamples: 2, maxQueryProjectionTokens: 10 },
    });

    expect(report.hookProfiles).toEqual([
      expect.objectContaining({ hookEvent: "Stop", sampleCount: 2, p95DurationMs: 10 }),
      expect.objectContaining({
        hookEvent: "UserPromptSubmit",
        sampleCount: 2,
        p95DurationMs: 20,
        status: "below",
      }),
    ]);
    expect(report.queryProjections.map((item) => item.status)).toEqual(["below", "exhausted"]);
    expect(report.disposition).toBe("blocked");
    expect(report.wholeTaskUsage.reasonCode).toBe("unmanaged_provider_usage_unobserved");
  });

  it("does not combine observations from different environment profiles", () => {
    const report = createTerminalBudgetReport({
      coverage: coverage({
        promptDurations: [10, 20],
        environmentDigests: [`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`],
      }),
      policy: { minimumSamples: 2 },
    });

    expect(report.hookProfiles).toHaveLength(4);
    expect(report.hookProfiles.every((profile) => profile.status === "unobservable")).toBe(true);
    expect(report.reasonCodes).toContain("sample_population_insufficient");
    expect(report.disposition).toBe("escalation_required");
  });

  it("fails closed when coverage marks a stage observation set invalid", () => {
    const source = coverage({ promptDurations: [10] });
    source.reports[0]!.stages.completeness = "invalid";
    source.reports[0]!.stages.missingReasons = ["stage_observation_invalid"];

    const report = createTerminalBudgetReport({ coverage: source, policy: { minimumSamples: 1 } });
    expect(report).toMatchObject({
      invalidStageObservationSetCount: 1,
      hookProfiles: [],
      disposition: "escalation_required",
    });
    expect(report.reasonCodes).toContain("stage_observation_invalid");
  });
});
