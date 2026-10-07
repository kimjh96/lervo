import { rm } from "node:fs/promises";

import { afterEach, expect, it } from "vitest";

import { recordKnowledgeWorkerMeasurement } from "../src/knowledge-worker-measurement.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("records an attributed knowledge-worker usage record and its review-context receipt", async () => {
  const f = await fixture();
  fixtures.push(f);
  const context = { storage: f.storage, provider: "codex" } as ConvergenceRuntimeContext;
  const input = {
    context,
    agentId: "agt_aaaaaaaaaaaaaaaaaaaaaaaa",
    task: "independent_canonical_review",
    snapshotHash: `sha256:${"3".repeat(64)}`,
    observationArtifactHash: `sha256:${"4".repeat(64)}`,
    admissionObservationHash: `sha256:${"5".repeat(64)}`,
    usage: {
      inputTokens: 900,
      cachedInputTokens: 300,
      outputTokens: 60,
      reasoningOutputTokens: 20,
      totalTokens: 960,
      contextWindow: null,
    },
    contextDocuments: [
      {
        path: "docs/specs/runtime.md",
        role: "canonical_candidate" as const,
        contentHash: `sha256:${"6".repeat(64)}`,
        content: "# Runtime\n",
      },
    ],
    occurredAt: "2026-10-05T00:00:00.000Z",
  };
  await recordKnowledgeWorkerMeasurement(input);
  // A retried stage call with the same observation never double-counts usage.
  await recordKnowledgeWorkerMeasurement(input);

  const events = f.storage.events.list();
  const usage = events.filter((event) => event.type === "resource.usage.recorded");
  expect(usage).toHaveLength(1);
  expect(usage[0]!.payload).toMatchObject({
    scope: "primary_provider",
    source: "provider_reported",
    status: "observed",
    agentId: "agt_aaaaaaaaaaaaaaaaaaaaaaaa",
    conversationDigest: null,
    channel: "knowledge_worker",
    stage: "independent_canonical_review",
    turnEventId: expect.stringMatching(/^kwt_[a-f0-9]{24}$/u),
    usage: expect.objectContaining({ totalTokens: 960 }),
  });
  expect(events.filter((event) => event.type === "context.selected")).toEqual([
    expect.objectContaining({
      runId: usage[0]!.runId,
      payload: expect.objectContaining({ origin: "managed_turn", required: false }),
    }),
  ]);
  expect(events.filter((event) => event.type === "document.loaded")).toEqual([
    expect.objectContaining({
      payload: expect.objectContaining({
        contentHash: `sha256:${"6".repeat(64)}`,
        sourceRevision: `sha256:${"3".repeat(64)}`,
      }),
    }),
  ]);
  expect(events.some((event) => event.type === "context.injected")).toBe(false);
});

it("fails with measurement_unavailable when the records cannot be stored", async () => {
  const f = await fixture();
  fixtures.push(f);
  const context = {
    storage: {
      ...f.storage,
      manifest: f.storage.manifest,
      artifacts: f.storage.artifacts,
      events: {
        get: () => null,
        transact: () => {
          throw new Error("event store unavailable");
        },
      },
    },
    provider: "claude",
  } as unknown as ConvergenceRuntimeContext;
  await expect(
    recordKnowledgeWorkerMeasurement({
      context,
      agentId: "agt_aaaaaaaaaaaaaaaaaaaaaaaa",
      task: "lifecycle_exact_plan_review",
      snapshotHash: `sha256:${"3".repeat(64)}`,
      observationArtifactHash: `sha256:${"7".repeat(64)}`,
      admissionObservationHash: `sha256:${"5".repeat(64)}`,
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningOutputTokens: 0,
        totalTokens: 2,
        contextWindow: null,
      },
      contextDocuments: [],
      occurredAt: "2026-10-05T00:00:00.000Z",
    }),
  ).rejects.toMatchObject({ code: "measurement_unavailable" });
});
