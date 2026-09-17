import type { WorkExecutionReport } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { projectWorkObservability } from "../src/index.js";

const hash = (value: string) => `sha256:${value.repeat(64)}`;

function workReport(): WorkExecutionReport {
  return {
    reportKind: "managed_work_execution",
    schemaVersion: 1,
    projectId: "prj_observability_test",
    workId: `wrk_${"1".repeat(24)}`,
    completeness: "complete",
    missingReasons: [],
    runs: [
      {
        runId: "run_observability_test",
        sessionIds: ["ses_observability_test"],
        relationship: "root",
        parentRunId: null,
        retryOfRunId: null,
        attemptOrdinal: 1,
        provider: "codex",
        status: "completed",
        firstOccurredAt: "2026-09-17T00:00:00.000Z",
        lastOccurredAt: "2026-09-17T00:00:01.000Z",
      },
    ],
    resources: {
      completeness: "complete",
      missingReasons: [],
      groups: [
        {
          provider: "codex",
          scope: "primary_provider",
          source: "provider_reported",
          accountingMode: "turn_cumulative",
          accountingDescriptorHash: hash("d"),
          completeness: "complete",
          missingReasons: [],
          observations: [
            {
              runId: "run_observability_test",
              resourceObservationId: `ruo_${"2".repeat(24)}`,
              sourceCoordinateDigest: hash("s"),
              status: "observed",
              usage: {
                inputTokens: 100,
                cachedInputTokens: 40,
                outputTokens: 20,
                reasoningOutputTokens: 5,
                totalTokens: 120,
                contextWindow: 200_000,
              },
              reasonCode: null,
            },
          ],
          totalUsage: {
            inputTokens: 100,
            cachedInputTokens: 40,
            outputTokens: 20,
            reasoningOutputTokens: 5,
            totalTokens: 120,
            contextWindow: 200_000,
          },
        },
      ],
    },
    stages: {
      completeness: "complete",
      missingReasons: [],
      observationSetCount: 1,
      observations: [
        {
          runId: "run_observability_test",
          observationSetId: `stgobs_${"3".repeat(24)}`,
          environmentProfileDigest: hash("e"),
          repositoryProfile: "medium",
          stages: [
            {
              stageId: "provider_turn",
              parentStageId: "total",
              durationMs: 1_000,
              budgetMs: null,
              outcome: "completed",
              coldState: "warm",
            },
          ],
        },
      ],
    },
    cost: { status: "not_in_foundation_scope" },
  };
}

describe("work observability projector", () => {
  it("preserves resource, cached-input, and stage meanings without fabricating other sections", () => {
    const report = projectWorkObservability({
      surface: { kind: "local_cli", adapterBuild: "cli:observability-v1" },
      sourceEventHeadHash: hash("a"),
      repositoryRevision: hash("b"),
      originCoordinate: null,
      stageCatalogVersion: 2,
      workReport: workReport(),
    });

    expect(validateSchema("surfaceObservabilityReport", report)).toEqual({
      valid: true,
      errors: [],
    });
    expect(report).toMatchObject({
      status: "partial",
      grounding: {
        status: "unavailable",
        documentCounts: { recommended: null, injected: null },
      },
      resources: {
        status: "complete",
        groups: [{ provider: "codex", usage: { totalTokens: 120 } }],
      },
      stages: { status: "complete", stageCatalogVersion: 2 },
      caches: {
        status: "complete",
        entries: [{ unit: "tokens", observedValue: 40 }],
      },
      result: { status: "partial", terminalStatus: "completed" },
    });
  });

  it("marks conflicting stage-catalog evidence invalid", () => {
    const report = projectWorkObservability({
      surface: { kind: "local_cli", adapterBuild: "cli:observability-v1" },
      sourceEventHeadHash: hash("a"),
      repositoryRevision: hash("b"),
      originCoordinate: null,
      stageCatalogVersion: null,
      stageCatalogConflict: true,
      workReport: workReport(),
    });

    expect(report).toMatchObject({
      status: "invalid",
      stages: {
        status: "invalid",
        stageCatalogVersion: null,
        reasonCode: "incompatible_stage_catalog_versions",
      },
    });
  });
});
