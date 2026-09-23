import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { FileSystemCas } from "@lervo/cas";
import type { EventDraftV2, EventDraftV3 } from "@lervo/event-contract";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { readLeasedConversationKnowledgeJob } from "../src/conversation-knowledge-lease.js";
import { inspectLeasedConversationKnowledgeSource } from "../src/conversation-knowledge-source-preflight.js";
import {
  compareRepositoryWork,
  observeRepositoryWork,
} from "../src/repository-work-observation.js";
import { prepareRepositoryWorkSourceManifest } from "../src/repository-work-source-manifest.js";
import {
  CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
  reconcileConversationKnowledgeOutbox,
} from "../src/conversation-knowledge-outbox-reconciliation.js";

const execute = promisify(execFile);
const projectId = "prj_knowledge_lease_01";
const hash = `sha256:${"a".repeat(64)}`;
const claimedAt = "2026-09-23T00:02:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-lease-"));
  roots.push(root);
  const repositoryRoot = resolve(root, "repo");
  await execute("git", ["init", "-b", "main", repositoryRoot]);
  await execute("git", ["config", "user.email", "lervo-test@example.invalid"], {
    cwd: repositoryRoot,
  });
  await execute("git", ["config", "user.name", "Lervo Test"], { cwd: repositoryRoot });
  await writeFile(resolve(repositoryRoot, "README.md"), "before\n");
  await execute("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execute("git", ["commit", "-m", "initial"], { cwd: repositoryRoot });
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 3,
  });
  const artifacts = await FileSystemCas.open(resolve(root, "cas"));
  return { repositoryRoot, events, artifacts };
}

function completionPayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceConversationEventId: `cve_${"b".repeat(64)}`,
    workerAgentId: `agt_${"c".repeat(24)}`,
    providerSessionDigest: hash,
    requestedModel: null,
    requestedReasoningEffort: null,
    executionProfile: null,
    allocationReason: "configured_default",
    requestContentHash: hash,
    resultContentHash: hash,
    resultByteCount: 4,
    repositoryRevisionBefore: hash,
    repositoryRevisionAfter: hash,
    changedPaths: [],
    changedPathCount: 0,
    workstreamId: `wks_${"d".repeat(24)}`,
    workstreamRevision: 1,
    workstreamSnapshotHash: hash,
    knowledgeDisposition: "baseline_valid",
    replicaDisposition: "not_configured",
    verificationStatus: "passed",
    completedAt: "2026-09-23T00:01:00.000Z",
    ...overrides,
  };
}

function draft(schemaVersion: 2 | 3, payload: Record<string, unknown>) {
  return {
    eventId: "evt_knowledge_lease_completion_01",
    projectId,
    runId: "run_knowledge_lease_01",
    sessionId: "ses_knowledge_lease_01",
    type: "conversation.repository_work.completed",
    occurredAt: "2026-09-23T00:01:00.000Z",
    actor: { kind: "agent", provider: "codex" },
    schemaVersion,
    policyVersion: hash,
    payload,
  } as EventDraftV2 | EventDraftV3;
}

function claim(events: SQLiteEventStore) {
  reconcileConversationKnowledgeOutbox({ events, afterSeq: 0, now: claimedAt });
  return events.claim({
    destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
    workerId: "knowledge-worker-1",
    claimedAt,
    leaseDurationMs: 60_000,
  })[0]!;
}

describe("leased conversation knowledge source", () => {
  it("rejects an ineligible completion even if a queue row was misrouted", async () => {
    const { events } = await fixture();
    const completion = events.append(
      draft(2, completionPayload({ knowledgeDisposition: "current" })),
    ).event;
    events.enqueue({
      eventId: completion.eventId,
      destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
      enqueuedAt: claimedAt,
    });
    const claimed = events.claim({
      destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
      workerId: "knowledge-worker-1",
      claimedAt,
      leaseDurationMs: 60_000,
    })[0]!;
    expect(() =>
      readLeasedConversationKnowledgeJob({
        events,
        claimed,
        workerId: "knowledge-worker-1",
        now: "2026-09-23T00:02:01.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_job_completion_invalid" }));
    events.close();
  });

  it("fences another worker, an expired lease, and a reclaimed attempt", async () => {
    const { events, artifacts, repositoryRoot } = await fixture();
    events.append(draft(2, completionPayload()));
    const claimed = claim(events);
    expect(
      readLeasedConversationKnowledgeJob({
        events,
        claimed,
        workerId: "knowledge-worker-1",
        now: "2026-09-23T00:02:01.000Z",
      }),
    ).toMatchObject({ attemptCount: 1, completion: { eventId: claimed.event.eventId } });
    expect(
      await inspectLeasedConversationKnowledgeSource({
        events,
        artifacts,
        repositoryRoot,
        claimed,
        workerId: "knowledge-worker-1",
        now: () => "2026-09-23T00:02:01.000Z",
      }),
    ).toMatchObject({ status: "needs_review", reasonCode: "legacy_source_unavailable" });
    expect(() =>
      readLeasedConversationKnowledgeJob({
        events,
        claimed,
        workerId: "knowledge-worker-2",
        now: "2026-09-23T00:02:01.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_job_lease_conflict" }));
    expect(() =>
      readLeasedConversationKnowledgeJob({
        events,
        claimed,
        workerId: "knowledge-worker-1",
        now: "2026-09-23T00:03:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_job_lease_conflict" }));
    const reclaimed = events.claim({
      destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
      workerId: "knowledge-worker-2",
      claimedAt: "2026-09-23T00:03:00.000Z",
      leaseDurationMs: 60_000,
    })[0]!;
    expect(reclaimed.attemptCount).toBe(2);
    expect(() =>
      readLeasedConversationKnowledgeJob({
        events,
        claimed,
        workerId: "knowledge-worker-1",
        now: "2026-09-23T00:03:01.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_job_lease_conflict" }));
    events.close();
  });

  it("reads a content-bound source only while the exact lease and bytes remain current", async () => {
    const { events, artifacts, repositoryRoot } = await fixture();
    const before = await observeRepositoryWork(repositoryRoot);
    await writeFile(resolve(repositoryRoot, "README.md"), "after\n");
    const after = await observeRepositoryWork(repositoryRoot);
    const change = await compareRepositoryWork({ repositoryRoot, before, after });
    const source = prepareRepositoryWorkSourceManifest({ before, after, change });
    await artifacts.put(source.content);
    events.append(
      draft(
        3,
        completionPayload({
          repositoryRevisionBefore: change.repositoryRevisionBefore,
          repositoryRevisionAfter: change.repositoryRevisionAfter,
          changedPaths: change.changedPaths,
          changedPathCount: 1,
          knowledgeDisposition: "pending_background",
          sourceManifestContentHash: source.contentHash,
          sourceManifestByteCount: source.content.byteLength,
          checkpointDisposition: "provider_checkpoint",
        }),
      ),
    );
    const claimed = claim(events);
    const input = {
      events,
      artifacts,
      repositoryRoot,
      claimed,
      workerId: "knowledge-worker-1",
      now: () => "2026-09-23T00:02:01.000Z",
    };
    expect(await inspectLeasedConversationKnowledgeSource(input)).toMatchObject({
      status: "ready_for_review",
      changedPathCount: 1,
      manifest: source.manifest,
    });
    await writeFile(resolve(repositoryRoot, "README.md"), "later\n");
    expect(await inspectLeasedConversationKnowledgeSource(input)).toMatchObject({
      status: "stale",
      reasonCode: "source_bytes_changed",
    });
    let clockReads = 0;
    await expect(
      inspectLeasedConversationKnowledgeSource({
        ...input,
        artifacts: {
          get: async (uri: string) => {
            const bytes = await artifacts.get(uri);
            events.reschedule({
              eventId: claimed.event.eventId,
              destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
              workerId: "knowledge-worker-1",
              failedAt: "2026-09-23T00:02:02.000Z",
              availableAt: "2026-09-23T00:02:03.000Z",
              failureCode: "source_changed",
            });
            return bytes;
          },
        } as never,
        now: () => (clockReads++ === 0 ? "2026-09-23T00:02:01.000Z" : "2026-09-23T00:02:03.000Z"),
      }),
    ).rejects.toMatchObject({ code: "knowledge_job_lease_conflict" });
    events.close();
  });
});
