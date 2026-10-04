import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createEventReaderCapabilities } from "@lervo/event-contract";
import {
  applyEventWriterActivationPlan,
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
} from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  conversationDigest,
  conversationRepositoryWorkCoordinates,
  repositoryWorkContextPointers,
  repositoryWorkMeasurement,
  type RepositoryWorkMeasurementRecord,
} from "../src/conversation-repository-work-measurement.js";

const roots: string[] = [];
const eventId = `cve_${"b".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-work-measurement-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_measure0001" }));
  // Usage records are schema-version-2 events; the repository-work completion needs the same.
  const evidence = {
    schemaVersion: 1 as const,
    projectId: "prj_measure0001",
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_local_runtime",
        readerKind: "local" as const,
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const plan = await planEventWriterActivation({
    repositoryRoot: root,
    evidence,
    targetEventSchemaVersion: 4,
  });
  await applyEventWriterActivationPlan({ plan, approval: plan.planId, currentEvidence: evidence });
  return root;
}

function record(
  root: string,
  usage: RepositoryWorkMeasurementRecord["usage"],
): RepositoryWorkMeasurementRecord {
  return {
    repositoryRoot: root,
    sourceConversationEventId: eventId,
    conversationId: "cnv_test0001",
    threadId: "thr_test0001",
    workerAgentId: "agt_111111111111111111111111",
    provider: "codex",
    requestedModel: "gpt-6-sol",
    providerSessionId: "11111111-1111-4111-8111-111111111111",
    usage,
    receipt: {
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      documents: [
        {
          documentId: "doc_path_000000000000000000000001",
          path: "docs/roadmap/v0.md",
          contentHash: `sha256:${"a".repeat(64)}`,
          byteCount: 12,
        },
      ],
    },
    occurredAt: "2026-10-05T00:00:00.000Z",
  };
}

async function recordedEvents(root: string) {
  const storage = await openProjectStorage(root);
  try {
    return storage.events.list({ runId: conversationRepositoryWorkCoordinates(eventId).runId });
  } finally {
    await storage.close();
  }
}

describe("conversation repository-work measurement", () => {
  it("records provider-reported usage attributed to agent, conversation, channel, turn, and stage", async () => {
    const root = await project();
    const input = record(root, {
      adapterId: "codex/repository-work",
      nativeCounterSemanticsId: "codex.exec-json.turn-completed.usage",
      status: "observed",
      usage: {
        inputTokens: 1_200,
        cachedInputTokens: 800,
        outputTokens: 90,
        reasoningOutputTokens: 40,
        totalTokens: 1_290,
        contextWindow: null,
      },
    });
    await repositoryWorkMeasurement.record(input);
    await repositoryWorkMeasurement.record(input);

    const events = await recordedEvents(root);
    expect(events.map((event) => event.type)).toEqual([
      "context.selected",
      "document.loaded",
      "resource.usage.recorded",
    ]);
    expect(events[2]!.payload).toMatchObject({
      source: "provider_reported",
      status: "observed",
      agentId: "agt_111111111111111111111111",
      conversationDigest: conversationDigest("cnv_test0001", "thr_test0001"),
      channel: "conversation",
      turnEventId: eventId,
      stage: "repository_work_turn",
      modelIdentity: expect.objectContaining({ provider: "codex", requestedModel: "gpt-6-sol" }),
      usage: expect.objectContaining({ totalTokens: 1_290 }),
    });
    expect(JSON.stringify(events)).not.toContain("cnv_test0001");
  });

  it("records an unreported usage gap instead of omitting the usage record", async () => {
    const root = await project();
    await repositoryWorkMeasurement.record(record(root, undefined));
    const usage = (await recordedEvents(root)).find(
      (event) => event.type === "resource.usage.recorded",
    );
    expect(usage?.payload).toMatchObject({
      status: "unavailable",
      usage: null,
      reasonCode: "provider_usage_unreported",
      channel: "conversation",
    });
  });

  it("points the provider at selected documents without injecting their bytes", () => {
    expect(
      repositoryWorkContextPointers({
        sourceRevision: "HEAD",
        documents: [
          {
            documentId: "doc_path_000000000000000000000001",
            path: "docs/roadmap/v0.md",
            contentHash: `sha256:${"a".repeat(64)}`,
            byteCount: 12,
          },
        ],
      }),
    ).toContain(`- docs/roadmap/v0.md (sha256:${"a".repeat(64)})`);
    expect(repositoryWorkContextPointers({ sourceRevision: "HEAD", documents: [] })).toBeNull();
  });
});
