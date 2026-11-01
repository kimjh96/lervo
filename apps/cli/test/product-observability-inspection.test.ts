import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { inspectProductObservability } from "../src/product-observability-inspection.js";
import {
  listedEvents,
  longHistoryEvents,
  longHistoryHeadSeq,
} from "../../../packages/storage-contract/test/listed-event-source.fixture.js";

const projectId = "prj_observability_query";
const workId = `wrk_${"1".repeat(24)}`;
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function event(
  seq: number,
  type: EventEnvelope["type"],
  payload: Record<string, unknown>,
  actor: EventEnvelope["actor"] = { kind: "system" },
): EventEnvelope {
  return {
    eventId: `evt_observability_query_${String(seq).padStart(4, "0")}`,
    projectId,
    runId: "run_observability_query",
    sessionId: "ses_observability_query",
    seq,
    type,
    occurredAt: `2026-09-17T00:00:${String(seq).padStart(2, "0")}.000Z`,
    actor,
    schemaVersion:
      type === "work.causality.recorded" ||
      type === "resource.usage.recorded" ||
      type === "execution.stages.observed"
        ? 2
        : 1,
    policyVersion: hash("a"),
    payload,
    previousHash: seq === 1 ? null : hash("b"),
    eventHash: hash(String(seq)),
  } as EventEnvelope;
}

function events() {
  return [
    event(1, "work.causality.recorded", {
      workId,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
    }),
    event(2, "run.requested", {}),
    event(3, "adapter.started", {}, { kind: "provider", provider: "codex" }),
    event(
      4,
      "resource.usage.recorded",
      {
        workId,
        resourceObservationId: `ruo_${"2".repeat(24)}`,
        sourceCoordinateDigest: hash("c"),
        scope: "primary_provider",
        source: "provider_reported",
        accountingMode: "turn_cumulative",
        accountingDescriptorHash: hash("d"),
        modelIdentity: {
          provider: "codex",
          requestedModel: null,
          answerModel: "codex-observed",
          observedModelIds: ["codex-observed"],
          answerModelEvidence: "thread_start",
          unavailableReason: null,
        },
        status: "observed",
        usage: {
          inputTokens: 100,
          cachedInputTokens: 60,
          outputTokens: 25,
          reasoningOutputTokens: 5,
          totalTokens: 125,
          contextWindow: 200_000,
        },
        reasonCode: null,
      },
      { kind: "provider", provider: "codex" },
    ),
    event(5, "execution.stages.observed", {
      executionMode: "managed",
      workId,
      terminalObservationId: null,
      terminalHook: null,
      observationSetId: `stgobs_${"3".repeat(24)}`,
      stageCatalogVersion: 2,
      environmentProfileDigest: hash("e"),
      repositoryProfile: "small",
      stages: [
        {
          stageId: "total",
          parentStageId: null,
          durationMs: 500,
          budgetMs: null,
          outcome: "completed",
          coldState: "warm",
        },
      ],
    }),
    event(6, "run.completed", {}),
  ];
}

describe("product observability inspection", () => {
  it("binds one verified event head and stable repository revision to the work report", async () => {
    const source = events();
    let closeCount = 0;
    let captureCount = 0;
    const report = await inspectProductObservability(
      { repositoryRoot: "/repository", workId, originCoordinate: "discord:thread-42" },
      {
        openStorage: async () => ({
          manifest: { projectId },
          events: {
            verifyIntegrity: () => ({
              valid: true,
              eventCount: source.length,
              headHash: source.at(-1)!.eventHash,
            }),
            list: listedEvents(source),
          },
          close: async () => {
            closeCount += 1;
          },
        }),
        captureSnapshot: async () => {
          captureCount += 1;
          return { revision: hash("f") };
        },
      },
    );

    expect(report).toMatchObject({
      sourceEventHeadHash: source.at(-1)!.eventHash,
      repositoryRevision: hash("f"),
      workCoordinate: `work:${workId}`,
      originCoordinate: "discord:thread-42",
      resources: { status: "complete", groups: [{ usage: { cachedInputTokens: 60 } }] },
      stages: { status: "complete", stageCatalogVersion: 2 },
      caches: { entries: [{ observedValue: 60, unit: "tokens" }] },
    });
    expect(captureCount).toBe(2);
    expect(closeCount).toBe(1);
  });

  it("projects one work beyond 100,000 events without walking the whole history", async () => {
    const history = longHistoryEvents(
      [...events(), event(7, "run.requested", {})].map((item, index) =>
        index === 6 ? { ...item, runId: "run_unrelated_work" } : item,
      ),
    );
    const report = await inspectProductObservability(
      { repositoryRoot: "/repository", workId, originCoordinate: null },
      {
        openStorage: async () => ({
          manifest: { projectId },
          events: {
            verifyIntegrity: () => ({
              valid: true,
              eventCount: longHistoryHeadSeq,
              headHash: history.head.eventHash,
            }),
            list: history.list,
          },
          close: async () => undefined,
        }),
        captureSnapshot: async () => ({ revision: hash("f") }),
      },
    );

    expect(report).toMatchObject({
      sourceEventHeadHash: history.head.eventHash,
      workCoordinate: `work:${workId}`,
      resources: { status: "complete", groups: [{ usage: { cachedInputTokens: 60 } }] },
      stages: { status: "complete", stageCatalogVersion: 2 },
    });
  });

  it("fails closed when the verified head changes during a long-history read", async () => {
    const history = longHistoryEvents(events());
    await expect(
      inspectProductObservability(
        { repositoryRoot: "/repository", workId, originCoordinate: null },
        {
          openStorage: async () => ({
            manifest: { projectId },
            events: {
              verifyIntegrity: () => ({
                valid: true,
                eventCount: longHistoryHeadSeq,
                headHash: hash("0"),
              }),
              list: history.list,
            },
            close: async () => undefined,
          }),
          captureSnapshot: async () => ({ revision: hash("f") }),
        },
      ),
    ).rejects.toThrowError("verified event head changed");
  });

  it("fails closed when repository bytes change during inspection", async () => {
    const source = events();
    let captureCount = 0;
    await expect(
      inspectProductObservability(
        { repositoryRoot: "/repository", workId, originCoordinate: null },
        {
          openStorage: async () => ({
            manifest: { projectId },
            events: {
              verifyIntegrity: () => ({
                valid: true,
                eventCount: source.length,
                headHash: source.at(-1)!.eventHash,
              }),
              list: listedEvents(source),
            },
            close: async () => undefined,
          }),
          captureSnapshot: async () => ({
            revision: hash(captureCount++ === 0 ? "f" : "9"),
          }),
        },
      ),
    ).rejects.toThrowError("changed during product observability inspection");
  });
});
